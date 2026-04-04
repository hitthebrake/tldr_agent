import { useCallback, useEffect, useRef, useState } from 'react'
import { useToasts } from 'tldraw'
import { TldrawAgent } from '../agent/TldrawAgent'
import { useAgent } from '../agent/TldrawAgentAppProvider'

const REALTIME_MODEL = 'gpt-4o-realtime-preview'

/** Must match `worker/routes/session.ts` and include `?model=` like the OpenAI realtime console sample. */
function realtimeCallsUrl() {
	const u = new URL('https://api.openai.com/v1/realtime/calls')
	u.searchParams.set('model', REALTIME_MODEL)
	return u.toString()
}

function waitForIceGatheringComplete(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
	if (pc.iceGatheringState === 'complete') return Promise.resolve()
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timeout)
			pc.removeEventListener('icegatheringstatechange', onState)
			resolve()
		}
		const onState = () => {
			if (pc.iceGatheringState === 'complete') done()
		}
		const timeout = setTimeout(done, timeoutMs)
		pc.addEventListener('icegatheringstatechange', onState)
	})
}

function waitForDataChannelOpen(dc: RTCDataChannel, timeoutMs: number): Promise<void> {
	if (dc.readyState === 'open') return Promise.resolve()
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error('Timed out waiting for voice link')), timeoutMs)
		dc.addEventListener(
			'open',
			() => {
				clearTimeout(t)
				resolve()
			},
			{ once: true }
		)
	})
}

type RealtimeSessionResponse = {
	/** GA client_secrets response */
	value?: string
	/** Legacy beta /sessions shape */
	client_secret?: { value: string; expires_at?: number }
	error?: { message?: string }
}

function sendFunctionCallOutput(dc: RTCDataChannel, callId: string, output: string) {
	if (dc.readyState !== 'open') return
	dc.send(
		JSON.stringify({
			type: 'conversation.item.create',
			item: {
				type: 'function_call_output',
				call_id: callId,
				output,
			},
		})
	)
	dc.send(JSON.stringify({ type: 'response.create' }))
}

function parseDelegatePromptCalls(event: {
	type?: string
	response?: { output?: unknown[] }
}): { callId: string; prompt: string }[] {
	if (event.type !== 'response.done' || !event.response?.output) return []
	const results: { callId: string; prompt: string }[] = []
	for (const item of event.response.output) {
		if (!item || typeof item !== 'object') continue
		const o = item as Record<string, unknown>
		if (o.type !== 'function_call' || o.name !== 'delegate_prompt') continue
		const callId = typeof o.call_id === 'string' ? o.call_id : ''
		if (!callId) continue
		let prompt = ''
		try {
			const raw = o.arguments
			const args =
				typeof raw === 'string' ? (JSON.parse(raw) as { prompt?: string }) : (raw as { prompt?: string })
			if (typeof args?.prompt === 'string') prompt = args.prompt
		} catch {
			continue
		}
		if (prompt) results.push({ callId, prompt })
	}
	return results
}

async function runDelegatePrompts(
	agent: TldrawAgent,
	calls: { callId: string; prompt: string }[],
	dc: RTCDataChannel
) {
	for (const { callId, prompt } of calls) {
		try {
			await agent.prompt(prompt)
			sendFunctionCallOutput(dc, callId, JSON.stringify({ ok: true }))
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e)
			sendFunctionCallOutput(dc, callId, JSON.stringify({ ok: false, error: message }))
		}
	}
}

export function VoiceCall() {
	const agent = useAgent()
	const agentRef = useRef(agent)
	useEffect(() => {
		agentRef.current = agent
	}, [agent])

	const toasts = useToasts()
	const [active, setActive] = useState(false)
	const [connecting, setConnecting] = useState(false)

	const pcRef = useRef<RTCPeerConnection | null>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const dcRef = useRef<RTCDataChannel | null>(null)
	const remoteAudioRef = useRef<HTMLAudioElement | null>(null)

	const teardown = useCallback(() => {
		dcRef.current = null
		if (pcRef.current) {
			pcRef.current.close()
			pcRef.current = null
		}
		if (streamRef.current) {
			for (const t of streamRef.current.getTracks()) t.stop()
			streamRef.current = null
		}
		if (remoteAudioRef.current) {
			remoteAudioRef.current.srcObject = null
			remoteAudioRef.current.remove()
			remoteAudioRef.current = null
		}
		setActive(false)
		setConnecting(false)
	}, [])

	const start = useCallback(async () => {
		setConnecting(true)
		try {
			const sessionRes = await fetch('/api/session', { method: 'POST' })
			let sessionJson: RealtimeSessionResponse
			try {
				sessionJson = (await sessionRes.json()) as RealtimeSessionResponse
			} catch {
				throw new Error(`Session failed (${sessionRes.status})`)
			}
			if (!sessionRes.ok) {
				const msg =
					sessionJson.error?.message ??
					(typeof sessionJson === 'object' && sessionJson && 'message' in sessionJson
						? String((sessionJson as { message?: string }).message)
						: sessionRes.statusText)
				throw new Error(msg || `Session failed (${sessionRes.status})`)
			}
			const ephemeral =
				sessionJson.value ??
				sessionJson.client_secret?.value ??
				(sessionJson as { session?: { client_secret?: { value?: string } } }).session?.client_secret
					?.value
			if (!ephemeral) throw new Error('No ephemeral client secret in session response')

			const pc = new RTCPeerConnection({
				iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
			})
			pcRef.current = pc

			const remoteAudio = document.createElement('audio')
			remoteAudio.autoplay = true
			remoteAudio.setAttribute('playsinline', 'true')
			remoteAudio.setAttribute('aria-hidden', 'true')
			remoteAudio.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none'
			document.body.appendChild(remoteAudio)
			remoteAudioRef.current = remoteAudio

			pc.ontrack = (e) => {
				if (remoteAudioRef.current && e.streams[0]) {
					remoteAudioRef.current.srcObject = e.streams[0]
					void remoteAudioRef.current.play().catch(() => {
						// Autoplay may still be blocked; user gesture already occurred on mic click.
					})
				}
			}

			const ms = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				},
			})
			streamRef.current = ms
			const [track] = ms.getAudioTracks()
			if (!track) throw new Error('No microphone audio track')
			pc.addTrack(track, ms)

			const dc = pc.createDataChannel('oai-events')
			dcRef.current = dc

			dc.addEventListener('message', (e) => {
				try {
					const data = JSON.parse(String(e.data)) as { type?: string; response?: { output?: unknown[] } }
					const calls = parseDelegatePromptCalls(data)
					if (calls.length === 0) return
					void runDelegatePrompts(agentRef.current, calls, dc)
				} catch {
					// ignore malformed events
				}
			})

			const offer = await pc.createOffer()
			await pc.setLocalDescription(offer)
			await waitForIceGatheringComplete(pc, 10_000)

			const localSdp = pc.localDescription?.sdp
			if (!localSdp?.trim()) throw new Error('Missing local SDP after ICE gathering')

			const sdpRes = await fetch(realtimeCallsUrl(), {
				method: 'POST',
				body: localSdp,
				headers: {
					Authorization: `Bearer ${ephemeral}`,
					'Content-Type': 'application/sdp',
				},
			})

			if (!sdpRes.ok) {
				const errText = await sdpRes.text()
				throw new Error(errText || `WebRTC handshake failed (${sdpRes.status})`)
			}

			const answerSdp = await sdpRes.text()
			await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

			await waitForDataChannelOpen(dc, 20_000)
			setActive(true)
		} catch (e) {
			teardown()
			const message = e instanceof Error ? e.message : 'Voice connection failed'
			toasts.addToast({ title: 'Voice', description: message, severity: 'error' })
			console.error(e)
		} finally {
			setConnecting(false)
		}
	}, [teardown, toasts])

	const toggle = useCallback(() => {
		if (active || connecting) {
			teardown()
			return
		}
		void start()
	}, [active, connecting, start, teardown])

	return (
		<button
			type="button"
			className={`voice-toggle-button ${active ? 'voice-toggle-button--on' : ''}`}
			onClick={toggle}
			disabled={connecting}
			title={
				active
					? 'Stop voice (ends live stream to OpenAI)'
					: 'Start voice — streams microphone live to OpenAI; nothing is saved as a file'
			}
			aria-pressed={active}
		>
			{connecting ? (
				<span className="voice-toggle-button__spinner" aria-hidden />
			) : (
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="currentColor"
					aria-hidden
					className="voice-toggle-button__icon"
				>
					<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
				</svg>
			)}
		</button>
	)
}

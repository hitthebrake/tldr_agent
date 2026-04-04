import { useCallback, useEffect, useRef, useState } from 'react'
import { useToasts } from 'tldraw'
import { TldrawAgent } from '../agent/TldrawAgent'
import { useAgent } from '../agent/TldrawAgentAppProvider'

/** Worker proxies SDP to OpenAI (see `worker/routes/realtimeCall.ts`). */
const REALTIME_CALL_URL = '/api/realtime/call'

function waitForIceGatheringComplete(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
	if (pc.iceGatheringState === 'complete') return Promise.resolve()
	return new Promise((resolve) => {
		let settled = false
		const cleanup = () => {
			clearTimeout(timeout)
			pc.removeEventListener('icegatheringstatechange', onGatheringState)
			pc.removeEventListener('icecandidate', onIceCandidate)
		}
		const finish = () => {
			if (settled) return
			settled = true
			cleanup()
			resolve()
		}
		const timeout = setTimeout(finish, timeoutMs)
		const onGatheringState = () => {
			if (pc.iceGatheringState === 'complete') finish()
		}
		const onIceCandidate = (ev: RTCPeerConnectionIceEvent) => {
			if (ev.candidate === null) finish()
		}
		pc.addEventListener('icegatheringstatechange', onGatheringState)
		pc.addEventListener('icecandidate', onIceCandidate)
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

function parseArgumentsPrompt(raw: unknown): string {
	if (raw == null) return ''
	try {
		const args =
			typeof raw === 'string' ? (JSON.parse(raw) as { prompt?: string }) : (raw as { prompt?: string })
		return typeof args?.prompt === 'string' ? args.prompt : ''
	} catch {
		return ''
	}
}

function delegateFromFunctionCallItem(item: Record<string, unknown>): { callId: string; prompt: string } | null {
	if (item.type !== 'function_call' || item.name !== 'delegate_prompt') return null
	const callId = typeof item.call_id === 'string' ? item.call_id : ''
	if (!callId) return null
	const prompt = parseArgumentsPrompt(item.arguments)
	return prompt ? { callId, prompt } : null
}

/**
 * Realtime emits tool calls on several events; audio sessions often finalize on
 * `response.function_call_arguments.done` or `response.output_item.done` before/instead of `response.done`.
 */
function extractDelegatePromptCalls(event: Record<string, unknown>): { callId: string; prompt: string }[] {
	const out: { callId: string; prompt: string }[] = []
	const push = (x: { callId: string; prompt: string } | null) => {
		if (x) out.push(x)
	}

	const t = event.type
	if (t === 'response.function_call_arguments.done') {
		if (event.name === 'delegate_prompt') {
			const callId = typeof event.call_id === 'string' ? event.call_id : ''
			const prompt = parseArgumentsPrompt(event.arguments)
			if (callId && prompt) out.push({ callId, prompt })
		}
		return out
	}

	if (t === 'response.output_item.done' && event.item && typeof event.item === 'object') {
		push(delegateFromFunctionCallItem(event.item as Record<string, unknown>))
		return out
	}

	if (t === 'response.done' && event.response && typeof event.response === 'object') {
		const resp = event.response as Record<string, unknown>
		const items = resp.output
		if (Array.isArray(items)) {
			for (const item of items) {
				if (item && typeof item === 'object') {
					push(delegateFromFunctionCallItem(item as Record<string, unknown>))
				}
			}
		}
	}

	return out
}

async function runDelegatePrompts(
	agent: TldrawAgent,
	calls: { callId: string; prompt: string }[],
	dc: RTCDataChannel,
	processedCallIds: Set<string>
) {
	for (const { callId, prompt } of calls) {
		if (processedCallIds.has(callId)) continue
		processedCallIds.add(callId)
		try {
			// nested: true avoids "already prompting" when chat/stream is active; still awaits completion.
			await agent.prompt(prompt, { nested: true })
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
	const processedVoiceToolCallsRef = useRef<Set<string>>(new Set())

	const teardown = useCallback(() => {
		processedVoiceToolCallsRef.current.clear()
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
					const data = JSON.parse(String(e.data)) as Record<string, unknown> & {
						type?: string
						error?: { message?: string; code?: string }
					}
					if (data.type === 'error') {
						const msg = data.error?.message ?? 'Realtime error'
						toasts.addToast({ title: 'Voice', description: msg, severity: 'error' })
						return
					}
					const calls = extractDelegatePromptCalls(data)
					if (calls.length === 0) return
					void runDelegatePrompts(agentRef.current, calls, dc, processedVoiceToolCallsRef.current)
				} catch {
					// ignore malformed events
				}
			})

			const offer = await pc.createOffer()
			await pc.setLocalDescription(offer)
			await waitForIceGatheringComplete(pc, 10_000)

			const localSdp = pc.localDescription?.sdp
			if (!localSdp?.trim()) throw new Error('Missing local SDP after ICE gathering')

			const sdpRes = await fetch(REALTIME_CALL_URL, {
				method: 'POST',
				body: localSdp,
				headers: {
					'Content-Type': 'application/sdp',
				},
			})

			if (!sdpRes.ok) {
				const errText = await sdpRes.text()
				let detail = errText
				try {
					const j = JSON.parse(errText) as { error?: { message?: string }; message?: string }
					detail = j.error?.message ?? j.message ?? errText
				} catch {
					// keep errText
				}
				throw new Error(detail || `WebRTC handshake failed (${sdpRes.status})`)
			}

			const answerSdp = await sdpRes.text()
			await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

			await waitForDataChannelOpen(dc, 20_000)
			// Prompt an initial short reply so the user hears that audio + the session are live.
			if (dc.readyState === 'open') {
				dc.send(JSON.stringify({ type: 'response.create' }))
			}
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

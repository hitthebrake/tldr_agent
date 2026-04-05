import { useEffect, useRef } from 'react'
import { useEditor } from 'tldraw'
import { getVoiceState, resetVoiceState, setVoiceState, subscribeVoiceState } from './voiceStore'

const SILENCE_FLUSH_MS = 3_000   // flush after 3s of no new words
const SAFETY_FLUSH_MS  = 20_000  // flush at most every 20s even if speech is continuous

/** Rendered inside the Tldraw context. Manages microphone + silence-based flush. No visual output. */
export function VoiceController() {
	const editor = useEditor()
	const transcriptRef   = useRef('')
	const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const safetyTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
	const recognitionRef  = useRef<any>(null)

	useEffect(() => {
		const SpeechRec =
			(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

		if (!SpeechRec) {
			setVoiceState({ error: 'Speech recognition is not supported in this browser (use Chrome or Edge)' })
			return
		}

		// ── Flush helper ─────────────────────────────────────────────────────
		async function flush() {
			if (getVoiceState().callActive) return
			const transcript = transcriptRef.current.trim()
			if (!transcript) return

			// Cancel any pending silence timer and reset safety timer
			if (silenceTimerRef.current) {
				clearTimeout(silenceTimerRef.current)
				silenceTimerRef.current = null
			}

			transcriptRef.current = ''
			setVoiceState({ transcript: '', processing: true, error: null })

			try {
				const shapes = editor
					.getCurrentPageShapes()
					.slice(0, 60)
					.map((shape) => {
						const b = editor.getShapePageBounds(shape)
						return {
							type: shape.type,
							id: shape.id,
							x: Math.round(b?.x ?? 0),
							y: Math.round(b?.y ?? 0),
							w: Math.round(b?.w ?? 0),
							h: Math.round(b?.h ?? 0),
						}
					})

				const res = await fetch('/api/voice-prompt', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ transcript, shapes }),
				})

				if (!res.ok) {
					const err = await res.json().catch(() => ({}))
					throw new Error((err as any).error || `Request failed (${res.status})`)
				}

				const data = (await res.json()) as { description: string }
				setVoiceState({
					processing: false,
					suggestion: { description: data.description, transcript },
				})
			} catch (e) {
				setVoiceState({
					processing: false,
					error: e instanceof Error ? e.message : String(e),
				})
			}
		}

		// ── Speech recognition ──────────────────────────────────────────────
		const recognition = new SpeechRec()
		recognition.continuous = true
		recognition.interimResults = true
		recognition.lang = 'en-US'

		recognition.onresult = (event: any) => {
			// Drop all input while the manual call has the mic
			if (getVoiceState().callActive) return

			for (let i = event.resultIndex; i < event.results.length; i++) {
				if (event.results[i].isFinal) {
					transcriptRef.current += event.results[i][0].transcript + ' '
					setVoiceState({ transcript: transcriptRef.current.trim() })

					// Reset 3s silence timer on every new final word
					if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
					silenceTimerRef.current = setTimeout(() => {
						silenceTimerRef.current = null
						void flush()
					}, SILENCE_FLUSH_MS)
				}
			}
		}

		recognition.onerror = (event: any) => {
			if (event.error === 'not-allowed') {
				setVoiceState({ error: 'Microphone permission denied', listening: false })
			}
		}

		// Auto-restart on end so recognition stays alive.
		// intentionalStop prevents restart when we stop it on purpose (call active).
		let restartPending = false
		let intentionalStop = false
		recognition.onend = () => {
			if (intentionalStop || restartPending) return
			restartPending = true
			setTimeout(() => {
				restartPending = false
				if (intentionalStop) return
				try { recognition.start() } catch {}
			}, 200)
		}

		recognition.start()
		recognitionRef.current = recognition
		setVoiceState({ listening: true, error: null })

		// ── Pause/resume on manual call ──────────────────────────────────────
		// IMPORTANT: never call setVoiceState synchronously inside this subscriber —
		// it would trigger emit() → this subscriber → setVoiceState → infinite loop.
		// All state updates are deferred with setTimeout(0).
		let prevCallActive = getVoiceState().callActive
		const unsubCall = subscribeVoiceState(() => {
			const { callActive } = getVoiceState()
			if (!prevCallActive && callActive) {
				// Call started — stop recognition immediately, defer state update
				intentionalStop = true
				transcriptRef.current = ''
				if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
				try { recognition.stop() } catch {}
				setTimeout(() => { setVoiceState({ transcript: '', listening: false }) }, 0)
			} else if (prevCallActive && !callActive) {
				// Call ended — restart recognition, defer state update
				intentionalStop = false
				restartPending = false
				setTimeout(() => {
					setVoiceState({ listening: true })
					try { recognition.start() } catch {}
				}, 0)
			}
			prevCallActive = callActive
		})

		// ── Safety flush (continuous speech fallback) ─────────────────────────
		safetyTimerRef.current = setInterval(() => { void flush() }, SAFETY_FLUSH_MS)

		return () => {
			unsubCall()
			intentionalStop = true
			recognition.onend = null
			recognition.stop()
			recognitionRef.current = null
			if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
			if (safetyTimerRef.current) { clearInterval(safetyTimerRef.current); safetyTimerRef.current = null }
			resetVoiceState()
		}
	}, [editor])

	return null
}

import { useEffect, useRef } from 'react'
import { useEditor } from 'tldraw'
import { getVoiceState, resetVoiceState, setVoiceState, subscribeVoiceState } from './voiceStore'
import { VoiceCollabClient } from './VoiceCollabClient'

const SILENCE_FLUSH_MS = 3_000  // flush after 3s of no new words
const SAFETY_FLUSH_MS  = 20_000 // flush even if speech is continuous

/** Rendered inside the Tldraw context. Manages microphone + collab voice flush. No visual output. */
export function VoiceController({ roomId }: { roomId: string }) {
	const editor = useEditor()
	const transcriptRef   = useRef('')
	const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const safetyTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
	const recognitionRef  = useRef<any>(null)
	const collabRef       = useRef<VoiceCollabClient | null>(null)

	useEffect(() => {
		const SpeechRec =
			(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

		if (!SpeechRec) {
			setVoiceState({ error: 'Speech recognition is not supported in this browser (use Chrome or Edge)' })
			return
		}

		// ── Voice collab WebSocket ───────────────────────────────────────────
		const collab = new VoiceCollabClient(roomId)
		collabRef.current = collab

		const unsubCollab = collab.onMessage((msg) => {
			if (msg.type === 'voice:processing') {
				setVoiceState({ processing: true, error: null })
			} else if (msg.type === 'voice:suggestion') {
				setVoiceState({
					processing: false,
					suggestion: {
						description: msg.description,
						transcript: transcriptRef.current.trim() || msg.combinedTranscript,
						combinedTranscript: msg.combinedTranscript,
					},
				})
			} else if (msg.type === 'voice:error') {
				setVoiceState({ processing: false, error: msg.error })
			} else if (msg.type === 'voice:clear') {
				setVoiceState({ suggestion: null })
			}
		})

		// ── Flush helper ─────────────────────────────────────────────────────
		function flush() {
			if (getVoiceState().callActive) return
			const transcript = transcriptRef.current.trim()
			if (!transcript) return

			if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }

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

			// Send to server — server aggregates all users and calls OpenAI
			collab.sendTranscript(transcript, shapes)

			transcriptRef.current = ''
			setVoiceState({ transcript: '' })
		}

		// ── Speech recognition ──────────────────────────────────────────────
		const recognition = new SpeechRec()
		recognition.continuous = true
		recognition.interimResults = true
		recognition.lang = 'en-US'

		recognition.onresult = (event: any) => {
			if (getVoiceState().callActive) return
			for (let i = event.resultIndex; i < event.results.length; i++) {
				if (event.results[i].isFinal) {
					transcriptRef.current += event.results[i][0].transcript + ' '
					setVoiceState({ transcript: transcriptRef.current.trim() })

					if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
					silenceTimerRef.current = setTimeout(() => {
						silenceTimerRef.current = null
						flush()
					}, SILENCE_FLUSH_MS)
				}
			}
		}

		recognition.onerror = (event: any) => {
			if (event.error === 'not-allowed') {
				setVoiceState({ error: 'Microphone permission denied', listening: false })
			}
		}

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
		let prevCallActive = getVoiceState().callActive
		const unsubCall = subscribeVoiceState(() => {
			const { callActive } = getVoiceState()
			if (!prevCallActive && callActive) {
				intentionalStop = true
				transcriptRef.current = ''
				if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
				try { recognition.stop() } catch {}
				setTimeout(() => { setVoiceState({ transcript: '', listening: false }) }, 0)
			} else if (prevCallActive && !callActive) {
				intentionalStop = false
				restartPending = false
				setTimeout(() => {
					setVoiceState({ listening: true })
					try { recognition.start() } catch {}
				}, 0)
			}
			prevCallActive = callActive
		})

		// ── Safety flush ─────────────────────────────────────────────────────
		safetyTimerRef.current = setInterval(() => flush(), SAFETY_FLUSH_MS)

		return () => {
			unsubCall()
			unsubCollab()
			collab.destroy()
			collabRef.current = null
			intentionalStop = true
			recognition.onend = null
			recognition.stop()
			recognitionRef.current = null
			if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
			if (safetyTimerRef.current) { clearInterval(safetyTimerRef.current); safetyTimerRef.current = null }
			resetVoiceState()
		}
	}, [editor, roomId])

	return null
}

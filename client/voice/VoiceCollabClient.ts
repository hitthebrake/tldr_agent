export type VoiceServerMessage =
	| { type: 'voice:suggestion'; description: string; combinedTranscript: string }
	| { type: 'voice:processing' }
	| { type: 'voice:clear' }
	| { type: 'voice:error'; error: string }

type MessageHandler = (msg: VoiceServerMessage) => void

/**
 * Manages the WebSocket connection to the room's voice collaboration endpoint.
 * Sends transcript chunks, receives aggregated suggestions from the server.
 */
export class VoiceCollabClient {
	private ws: WebSocket | null = null
	private handlers = new Set<MessageHandler>()
	private readonly sessionId: string
	private readonly roomId: string
	private closed = false
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null

	constructor(roomId: string) {
		this.roomId = roomId
		this.sessionId = crypto.randomUUID()
		this.connect()
	}

	private connect() {
		if (this.closed) return
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
		const url = `${protocol}//${window.location.host}/api/voice-collab/${this.roomId}?sessionId=${this.sessionId}`
		const ws = new WebSocket(url)
		this.ws = ws

		ws.addEventListener('message', (e) => {
			try {
				const msg = JSON.parse(String(e.data)) as VoiceServerMessage
				for (const h of this.handlers) h(msg)
			} catch {}
		})

		ws.addEventListener('close', () => {
			if (!this.closed) {
				this.reconnectTimer = setTimeout(() => this.connect(), 1_500)
			}
		})

		ws.addEventListener('error', () => {
			// close event will fire after error, which triggers reconnect
		})
	}

	sendTranscript(transcript: string, shapes: unknown[]) {
		this.send({ type: 'voice:transcript', transcript, shapes })
	}

	sendClear() {
		this.send({ type: 'voice:clear' })
	}

	onMessage(handler: MessageHandler): () => void {
		this.handlers.add(handler)
		return () => this.handlers.delete(handler)
	}

	private send(msg: object) {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg))
		}
	}

	destroy() {
		this.closed = true
		if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
		this.ws?.close()
		this.ws = null
		this.handlers.clear()
	}
}

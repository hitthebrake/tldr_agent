import { DurableObjectSqliteSyncWrapper, SQLiteSyncStorage, TLSocketRoom } from '@tldraw/sync-core'
import {
	createTLSchema,
	// defaultBindingSchemas,
	defaultShapeSchemas,
	TLRecord,
} from '@tldraw/tlschema'
import { DurableObject } from 'cloudflare:workers'
import { AutoRouter, error, IRequest } from 'itty-router'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { Environment } from './environment'

// add custom shapes and bindings here if needed:
const schema = createTLSchema({
	shapes: { ...defaultShapeSchemas },
	// bindings: { ...defaultBindingSchemas },
})

interface ShapeStub {
	type: string; id: string; x: number; y: number; w: number; h: number
}

// Each whiteboard room is hosted in a Durable Object.
// https://developers.cloudflare.com/durable-objects/
//
// There's only ever one durable object instance per room. Room state is
// persisted automatically to SQLite via ctx.storage.
export class TldrawDurableObject extends DurableObject<Environment> {
	private room: TLSocketRoom<TLRecord, void>

	// ── Voice collab state ───────────────────────────────────────────────────
	private voiceClients     = new Map<string, WebSocket>()     // sessionId → ws
	private voiceTranscripts = new Map<string, string>()        // sessionId → transcript
	private voiceShapes: ShapeStub[] = []
	private voiceFlushTimer:  ReturnType<typeof setTimeout> | null = null
	private voiceSafetyTimer: ReturnType<typeof setInterval> | null = null
	private voiceProcessing = false

	constructor(ctx: DurableObjectState, env: Environment) {
		super(ctx, env)
		// Create SQLite-backed storage - persists automatically to Durable Object storage
		const sql = new DurableObjectSqliteSyncWrapper(ctx.storage)
		const storage = new SQLiteSyncStorage<TLRecord>({ sql })

		// Create the room that handles sync protocol
		this.room = new TLSocketRoom<TLRecord, void>({ schema, storage })
	}

	private readonly router = AutoRouter({ catch: (e) => error(e) })
		.get('/api/connect/:roomId',      (request) => this.handleConnect(request))
		.get('/api/voice-collab/:roomId', (request) => this.handleVoiceConnect(request))

	// Entry point for all requests to the Durable Object
	override fetch(request: Request): Response | Promise<Response> {
		return this.router.fetch(request)
	}

	// Handle new WebSocket connection requests
	async handleConnect(request: IRequest) {
		const sessionId = request.query.sessionId as string
		if (!sessionId) return error(400, 'Missing sessionId')

		// Create the websocket pair for the client
		const { 0: clientWebSocket, 1: serverWebSocket } = new WebSocketPair()
		serverWebSocket.accept()

		// Connect to the room
		this.room.handleSocketConnect({ sessionId, socket: serverWebSocket })

		return new Response(null, { status: 101, webSocket: clientWebSocket })
	}

	// Handle voice collab WebSocket connections
	async handleVoiceConnect(request: IRequest) {
		const sessionId = request.query.sessionId as string
		if (!sessionId) return error(400, 'Missing sessionId')

		const { 0: clientWebSocket, 1: serverWebSocket } = new WebSocketPair()
		serverWebSocket.accept()
		this.voiceClients.set(sessionId, serverWebSocket)

		serverWebSocket.addEventListener('message', (event) => {
			try {
				const msg = JSON.parse(String(event.data))
				this.handleVoiceMessage(sessionId, msg)
			} catch {}
		})

		serverWebSocket.addEventListener('close', () => {
			this.voiceClients.delete(sessionId)
			this.voiceTranscripts.delete(sessionId)
		})

		return new Response(null, { status: 101, webSocket: clientWebSocket })
	}

	private handleVoiceMessage(sessionId: string, msg: { type: string; transcript?: string; shapes?: ShapeStub[] }) {
		if (msg.type === 'voice:transcript') {
			const transcript = (msg.transcript ?? '').trim()
			if (transcript) {
				// Append to existing buffer so chunks from the same user accumulate,
				// and chunks arriving before the debounce fires aren't lost.
				const existing = this.voiceTranscripts.get(sessionId) ?? ''
				this.voiceTranscripts.set(sessionId, existing ? existing + ' ' + transcript : transcript)
				if (msg.shapes?.length) this.voiceShapes = msg.shapes
			}
			// Silence debounce: flush 5s after the last word from anyone.
			if (this.voiceFlushTimer) clearTimeout(this.voiceFlushTimer)
			this.voiceFlushTimer = setTimeout(() => {
				this.voiceFlushTimer = null
				void this.flushVoice()
			}, 5_000)

			// Start 20s safety interval on first transcript if not already running.
			if (!this.voiceSafetyTimer) {
				this.voiceSafetyTimer = setInterval(() => { void this.flushVoice() }, 20_000)
			}
		} else if (msg.type === 'voice:clear') {
			if (this.voiceFlushTimer) { clearTimeout(this.voiceFlushTimer); this.voiceFlushTimer = null }
			if (this.voiceSafetyTimer) { clearInterval(this.voiceSafetyTimer); this.voiceSafetyTimer = null }
			this.voiceTranscripts.clear()
			this.voiceShapes = []
			this.broadcastVoice({ type: 'voice:clear' })
		}
	}

	private async flushVoice() {
		if (this.voiceProcessing) return
		const entries = [...this.voiceTranscripts.entries()]
		if (entries.length === 0) return

		// Cancel silence debounce (may have been triggered by safety interval)
		if (this.voiceFlushTimer) { clearTimeout(this.voiceFlushTimer); this.voiceFlushTimer = null }
		// Stop safety interval — will restart on next incoming transcript
		if (this.voiceSafetyTimer) { clearInterval(this.voiceSafetyTimer); this.voiceSafetyTimer = null }

		this.voiceProcessing = true
		this.voiceTranscripts.clear()
		this.broadcastVoice({ type: 'voice:processing' })

		// Build a combined transcript labelled by user index
		const combinedTranscript = entries.length === 1
			? entries[0][1]
			: entries.map(([, t], i) => `User ${i + 1}: ${t}`).join('\n')

		const shapes = this.voiceShapes
		const canvasDescription =
			shapes.length === 0
				? 'The canvas is empty.'
				: `The canvas has ${shapes.length} shape(s): ` +
				  shapes.map((s) => `${s.type} at (${s.x},${s.y}) size ${s.w}×${s.h}`).join('; ') + '.'

		try {
			const openai = createOpenAI({ apiKey: this.env.OPENAI_API_KEY })
			const { text } = await generateText({
				model: openai('gpt-4o-mini'),
				messages: [
					{
						role: 'system',
						content:
							'You are an AI assistant for a collaborative whiteboard. ' +
							'Given voice input from one or more users and the current canvas state, ' +
							'describe in ONE concise sentence what canvas changes you would make. ' +
							'Be specific and action-oriented. Do not ask for clarification.',
					},
					{
						role: 'user',
						content: `Canvas state: ${canvasDescription}\n\nUsers said:\n${combinedTranscript}\n\nWhat will you do?`,
					},
				],
			})

			this.broadcastVoice({
				type: 'voice:suggestion',
				description: text.trim(),
				combinedTranscript,
			})
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e)
			this.broadcastVoice({ type: 'voice:error', error: message })
		} finally {
			this.voiceProcessing = false
		}
	}

	private broadcastVoice(msg: object) {
		const data = JSON.stringify(msg)
		for (const ws of this.voiceClients.values()) {
			try { ws.send(data) } catch {}
		}
	}
}

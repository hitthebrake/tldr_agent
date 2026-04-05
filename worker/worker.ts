import { handleUnfurlRequest } from 'cloudflare-workers-unfurl'
import { AutoRouter, error, IRequest } from 'itty-router'
import { handleAssetDownload, handleAssetUpload } from './assetUploads'
import { Environment } from './environment'
import {
	handleHiggsfieldFetchMedia,
	handleHiggsfieldImage,
	handleHiggsfieldVideo,
} from './routes/higgsfield'
import { realtimeCall } from './routes/realtimeCall'
import { session } from './routes/session'
import { stream } from './routes/stream'
import { handleVoicePrompt } from './routes/voicePrompt'

// make sure our durable objects are made available to cloudflare
export { TldrawDurableObject } from './TldrawDurableObject'
export { AgentDurableObject } from './do/AgentDurableObject'

// we use itty-router (https://itty.dev/) to handle routing. in this example we turn on CORS because
// we're hosting the worker separately to the client. you should restrict this to your own domain.
const router = AutoRouter<IRequest, [env: Environment, ctx: ExecutionContext]>({
	catch: (e) => {
		console.error(e)
		return error(e)
	},
})
	// requests to /connect are routed to the Durable Object, and handle realtime websocket syncing
	.get('/api/connect/:roomId', (request, env) => {
		const id = env.TLDRAW_DURABLE_OBJECT.idFromName(request.params.roomId)
		const room = env.TLDRAW_DURABLE_OBJECT.get(id)
		return room.fetch(request.url, { headers: request.headers, body: request.body })
	})

	// voice collab WebSocket — same DO instance as the room, shares in-process voice state
	.get('/api/voice-collab/:roomId', (request, env) => {
		const id = env.TLDRAW_DURABLE_OBJECT.idFromName(request.params.roomId)
		const room = env.TLDRAW_DURABLE_OBJECT.get(id)
		return room.fetch(request.url, { headers: request.headers, body: request.body })
	})

	// assets can be uploaded to the bucket under /uploads:
	.post('/api/uploads/:uploadId', handleAssetUpload)

	// they can be retrieved from the bucket too:
	.get('/api/uploads/:uploadId', handleAssetDownload)

	// bookmarks need to extract metadata from pasted URLs:
	.get('/api/unfurl', handleUnfurlRequest)

	// AI agent streaming endpoint
	.post('/stream', stream)

	// OpenAI Realtime (voice): ephemeral key (optional / legacy clients)
	.post('/api/session', session)
	// OpenAI Realtime (voice): server-side SDP exchange (recommended for browsers)
	.post('/api/realtime/call', realtimeCall)

	// Higgsfield (image / video) — keys from env; never expose to the client
	.post('/api/higgsfield/image', (request, env) => handleHiggsfieldImage(request, env))
	.post('/api/higgsfield/video', (request, env) => handleHiggsfieldVideo(request, env))
	.post('/api/higgsfield/fetch-media', (request) => handleHiggsfieldFetchMedia(request))

	// Voice prompt — batched transcript → GPT-4o-mini → suggestion description
	.post('/api/voice-prompt', (request, env) => handleVoicePrompt(request, env))

	.all('*', () => {
		return new Response('Not found', { status: 404 })
	})

export default {
	fetch: router.fetch,
}

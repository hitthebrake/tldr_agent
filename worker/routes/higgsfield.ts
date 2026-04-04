import { Environment } from '../environment'

const PLATFORM = 'https://platform.higgsfield.ai'

const DEFAULT_IMAGE_MODEL = 'higgsfield-ai/soul/standard'
const DEFAULT_VIDEO_MODEL = 'kling-video/v2.1/pro/image-to-video'

function getAuthHeader(env: Environment): string | null {
	const key = env.HIGGSFIELD_API_KEY
	const secret = env.HIGGSFIELD_API_SECRET
	if (!key || !secret) return null
	return `Key ${key}:${secret}`
}

type HfStatusResponse = {
	status: string
	status_url?: string
	images?: { url: string }[]
	video?: { url: string }
	error?: string
	message?: string
}

async function pollUntilDone(
	auth: string,
	initial: HfStatusResponse,
	maxWaitMs = 240_000
): Promise<HfStatusResponse> {
	if (initial.status === 'completed') return initial
	const statusUrl = initial.status_url
	if (!statusUrl) {
		throw new Error('Higgsfield response missing status_url')
	}
	const deadline = Date.now() + maxWaitMs
	let delay = 2000
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, delay))
		const res = await fetch(statusUrl, {
			headers: { Authorization: auth, Accept: 'application/json' },
		})
		if (!res.ok) {
			const t = await res.text()
			throw new Error(t || `Status HTTP ${res.status}`)
		}
		const data = (await res.json()) as HfStatusResponse
		if (data.status === 'completed') return data
		if (data.status === 'failed' || data.status === 'nsfw') {
			throw new Error(data.error || data.message || `Generation ${data.status}`)
		}
		delay = Math.min(5000, Math.floor(delay * 1.2))
	}
	throw new Error('Generation timed out while waiting for Higgsfield')
}

export async function handleHiggsfieldImage(request: Request, env: Environment): Promise<Response> {
	const auth = getAuthHeader(env)
	if (!auth) {
		return Response.json(
			{
				error:
					'Higgsfield API keys are not configured. Set HIGGSFIELD_API_KEY and HIGGSFIELD_API_SECRET (see wrangler.toml / .dev.vars).',
			},
			{ status: 503 }
		)
	}
	let body: { prompt?: string; aspect_ratio?: string; resolution?: string; model_id?: string }
	try {
		body = (await request.json()) as typeof body
	} catch {
		return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
	}
	const prompt = body.prompt?.trim()
	if (!prompt) {
		return Response.json({ error: 'Missing prompt' }, { status: 400 })
	}
	const modelId = (body.model_id || DEFAULT_IMAGE_MODEL).replace(/^\//, '')
	const url = `${PLATFORM}/${modelId}`
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: auth,
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify({
			prompt,
			aspect_ratio: body.aspect_ratio || '16:9',
			resolution: body.resolution || '720p',
		}),
	})
	if (!res.ok) {
		const t = await res.text()
		return Response.json({ error: t || `Higgsfield HTTP ${res.status}` }, { status: 502 })
	}
	const initial = (await res.json()) as HfStatusResponse
	try {
		const done = await pollUntilDone(auth, initial)
		const imageUrl = done.images?.[0]?.url
		if (!imageUrl) {
			return Response.json({ error: 'Completed but no image URL in response' }, { status: 502 })
		}
		return Response.json({ url: imageUrl })
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		return Response.json({ error: msg }, { status: 502 })
	}
}

export async function handleHiggsfieldVideo(request: Request, env: Environment): Promise<Response> {
	const auth = getAuthHeader(env)
	if (!auth) {
		return Response.json(
			{
				error:
					'Higgsfield API keys are not configured. Set HIGGSFIELD_API_KEY and HIGGSFIELD_API_SECRET (see wrangler.toml / .dev.vars).',
			},
			{ status: 503 }
		)
	}
	let body: {
		prompt?: string
		image_url?: string
		image_data?: string
		duration?: number
		model_id?: string
	}
	try {
		body = (await request.json()) as typeof body
	} catch {
		return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
	}
	const prompt = body.prompt?.trim() || 'animate'

	let imageBase64: string

	if (body.image_data) {
		// Strip the data URI prefix — Higgsfield expects raw base64, not a data URI or URL
		const commaIdx = body.image_data.indexOf(',')
		imageBase64 = commaIdx !== -1 ? body.image_data.slice(commaIdx + 1) : body.image_data
	} else if (body.image_url) {
		imageBase64 = body.image_url.trim()
	} else {
		return Response.json({ error: 'Missing image_url or image_data' }, { status: 400 })
	}

	const modelId = (body.model_id || DEFAULT_VIDEO_MODEL).replace(/^\//, '')
	const url = `${PLATFORM}/${modelId}`
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: auth,
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify({
			image_url: imageBase64,
			prompt,
			duration: body.duration ?? 5,
		}),
	})
	if (!res.ok) {
		const t = await res.text()
		return Response.json({ error: t || `Higgsfield HTTP ${res.status}` }, { status: 502 })
	}
	const initial = (await res.json()) as HfStatusResponse
	try {
		const done = await pollUntilDone(auth, initial)
		const videoUrl = done.video?.url
		if (!videoUrl) {
			return Response.json({ error: 'Completed but no video URL in response' }, { status: 502 })
		}
		return Response.json({ url: videoUrl })
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		return Response.json({ error: msg }, { status: 502 })
	}
}

const MAX_FETCH_MEDIA_BYTES = 40 * 1024 * 1024

/**
 * Server-side fetch of Higgsfield result URLs so the browser can build Files and run them through TLAssetStore.
 */
export async function handleHiggsfieldFetchMedia(request: Request): Promise<Response> {
	let body: { url?: string }
	try {
		body = (await request.json()) as { url?: string }
	} catch {
		return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
	}
	const urlStr = body.url?.trim()
	if (!urlStr) {
		return Response.json({ error: 'Missing url' }, { status: 400 })
	}
	let parsed: URL
	try {
		parsed = new URL(urlStr)
	} catch {
		return Response.json({ error: 'Invalid url' }, { status: 400 })
	}
	if (parsed.protocol !== 'https:') {
		return Response.json({ error: 'Only https URLs are allowed' }, { status: 400 })
	}
	const upstream = await fetch(urlStr, { redirect: 'follow' })
	if (!upstream.ok) {
		return Response.json(
			{ error: `Failed to download media (${upstream.status})` },
			{ status: 502 }
		)
	}
	const cl = upstream.headers.get('content-length')
	if (cl && Number(cl) > MAX_FETCH_MEDIA_BYTES) {
		return Response.json({ error: 'Remote file too large' }, { status: 413 })
	}
	const buf = await upstream.arrayBuffer()
	if (buf.byteLength > MAX_FETCH_MEDIA_BYTES) {
		return Response.json({ error: 'Remote file too large' }, { status: 413 })
	}
	const ct =
		upstream.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream'
	return new Response(buf, {
		headers: {
			'Content-Type': ct,
			'Cache-Control': 'private, max-age=120',
		},
	})
}

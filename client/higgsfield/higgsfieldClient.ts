import { Box, createShapesForAssets, Editor, TLImageAsset, TLImageShape, uniqueId, VecModel } from 'tldraw'
import { HiggsfieldJobHooks, runHiggsfieldJob } from './higgsfieldGenerationStore'

const MAX_MEDIA_BYTES = 40 * 1024 * 1024

/** Max width/height (px) for placed media; also capped relative to viewport. */
const MAX_MEDIA_EDGE_PX = 420
const VIEWPORT_FRACTION = 0.36

const PLACE_GAP = 14
const GRID_STEP = 40

function mimeToExtension(mime: string): string {
	const m = mime.toLowerCase()
	if (m.includes('png')) return 'png'
	if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
	if (m.includes('webp')) return 'webp'
	if (m.includes('gif')) return 'gif'
	if (m.includes('mp4')) return 'mp4'
	if (m.includes('webm')) return 'webm'
	if (m.includes('quicktime') || m.includes('mov')) return 'mov'
	return 'bin'
}

export async function fetchHiggsfieldMediaAsFile(remoteUrl: string, baseName: string): Promise<File> {
	const res = await fetch('/api/higgsfield/fetch-media', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ url: remoteUrl }),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		const msg =
			typeof err === 'object' && err && 'error' in err
				? String((err as { error: string }).error)
				: res.statusText
		throw new Error(msg || `fetch-media failed (${res.status})`)
	}
	const len = res.headers.get('content-length')
	if (len && Number(len) > MAX_MEDIA_BYTES) {
		throw new Error('Media response too large')
	}
	const blob = await res.blob()
	if (blob.size > MAX_MEDIA_BYTES) {
		throw new Error('Media file too large')
	}
	const type = blob.type || 'application/octet-stream'
	const ext = mimeToExtension(type)
	const name = `${baseName}-${uniqueId()}.${ext}`
	return new File([blob], name, { type })
}

export async function higgsfieldGeneratePictureUrl(prompt: string): Promise<string> {
	const res = await fetch('/api/higgsfield/image', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ prompt: prompt.trim() }),
	})
	const data = (await res.json()) as { url?: string; error?: string }
	if (!res.ok) throw new Error(data.error || `Picture request failed (${res.status})`)
	if (!data.url) throw new Error('No picture URL returned')
	return data.url
}

export async function higgsfieldGenerateVideoUrl(imageUrl: string, prompt: string): Promise<string> {
	const res = await fetch('/api/higgsfield/video', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			image_url: imageUrl.trim(),
			prompt: prompt.trim(),
		}),
	})
	const data = (await res.json()) as { url?: string; error?: string }
	if (!res.ok) throw new Error(data.error || `Video request failed (${res.status})`)
	if (!data.url) throw new Error('No video URL returned')
	return data.url
}

/**
 * Returns the public HTTPS src URL of the single selected image shape, or null if none.
 * Used for image-to-video: user selects a canvas image, then animates it.
 */
export function getSelectedImageUrl(editor: Editor): string | null {
	const selected = editor.getSelectedShapes()
	if (selected.length !== 1) return null
	const shape = selected[0]
	if (shape.type !== 'image') return null
	const imageShape = shape as TLImageShape
	const assetId = imageShape.props.assetId
	if (!assetId) return null
	const asset = editor.getAsset(assetId)
	if (!asset || asset.type !== 'image') return null
	const src = (asset as TLImageAsset).props.src
	if (!src) return null
	// Asset URLs are relative paths (/api/uploads/...) — make absolute for Higgsfield
	if (src.startsWith('https://')) return src
	if (src.startsWith('/')) return `${window.location.origin}${src}`
	return null
}

/**
 * Find top-left of a w×h box inside/near the viewport that doesn't overlap existing shapes (with gap).
 */
export function findClearPlacement(editor: Editor, w: number, h: number): VecModel {
	const vb = editor.getViewportPageBounds()
	const shapes = editor.getCurrentPageShapes()
	const obstacles: Box[] = []
	for (const s of shapes) {
		const b = editor.getShapePageBounds(s.id)
		if (b && b.isValid() && b.width > 2 && b.height > 2) {
			obstacles.push(Box.ExpandBy(b, PLACE_GAP))
		}
	}

	const tryBox = (x: number, y: number) => {
		const place = new Box(x, y, w, h).expandBy(PLACE_GAP)
		for (const ob of obstacles) {
			if (Box.Collides(place, ob)) return false
		}
		return true
	}

	const pad = 20
	// Scan from lower-left of viewport upward in rows
	for (let row = 0; row < 50; row++) {
		const y = vb.maxY - pad - h - row * GRID_STEP
		for (let col = 0; col < 60; col++) {
			const x = vb.minX + pad + col * GRID_STEP
			if (tryBox(x, y)) return { x, y }
		}
	}
	// Below viewport
	for (let row = 0; row < 20; row++) {
		const y = vb.maxY + pad + row * GRID_STEP
		for (let col = 0; col < 40; col++) {
			const x = vb.minX + pad + col * GRID_STEP
			if (tryBox(x, y)) return { x, y }
		}
	}
	// Fallback
	return { x: vb.minX + pad, y: vb.maxY - pad - h }
}

/**
 * Upload file through the asset store, scale down display size, place in empty viewport area.
 */
export async function placeHiggsfieldFileOnCanvas(editor: Editor, file: File): Promise<void> {
	const asset = await editor.getAssetForExternalContent({ type: 'file', file })
	if (!asset || (asset.type !== 'image' && asset.type !== 'video')) {
		throw new Error('Could not create image or video asset from file')
	}

	const nw = asset.props.w
	const nh = asset.props.h
	const vb = editor.getViewportPageBounds()
	const maxByView = Math.min(MAX_MEDIA_EDGE_PX, vb.width * VIEWPORT_FRACTION)
	const scale = Math.min(1, maxByView / Math.max(nw, nh, 1))
	const w = Math.max(64, Math.round(nw * scale))
	const h = Math.max(64, Math.round(nh * scale))

	const scaled = { ...asset, props: { ...asset.props, w, h } }
	editor.run(() => editor.updateAssets([scaled]), { history: 'record', ignoreShapeLock: true })

	const point = findClearPlacement(editor, w, h)

	// Save camera so placement never zooms/pans any user's view
	const savedCamera = editor.getCamera()
	await createShapesForAssets(editor, [scaled], point)
	editor.setCamera(savedCamera, { animation: { duration: 0 } })
}

export function queueHiggsfieldPicture(
	editor: Editor,
	prompt: string,
	hooks?: HiggsfieldJobHooks
): void {
	runHiggsfieldJob(
		'Higgsfield: generating picture…',
		async () => {
			const url = await higgsfieldGeneratePictureUrl(prompt)
			const file = await fetchHiggsfieldMediaAsFile(url, 'higgsfield-picture')
			await placeHiggsfieldFileOnCanvas(editor, file)
		},
		hooks
	)
}

export function queueHiggsfieldVideo(
	editor: Editor,
	sourceImageUrl: string,
	prompt: string,
	hooks?: HiggsfieldJobHooks
): void {
	runHiggsfieldJob(
		'Higgsfield: generating video…',
		async () => {
			const url = await higgsfieldGenerateVideoUrl(sourceImageUrl, prompt)
			const file = await fetchHiggsfieldMediaAsFile(url, 'higgsfield-video')
			await placeHiggsfieldFileOnCanvas(editor, file)
		},
		hooks
	)
}

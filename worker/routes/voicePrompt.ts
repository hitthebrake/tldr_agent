import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { Environment } from '../environment'

interface ShapeStub {
	type: string
	id: string
	x: number
	y: number
	w: number
	h: number
}

/**
 * POST /api/voice-prompt
 * Body: { transcript: string, shapes: ShapeStub[] }
 * Returns: { description: string }
 *
 * Receives a 60-second voice transcript + current canvas shapes, asks GPT-4o-mini
 * to summarise what canvas changes it would make, and returns that description.
 * The frontend shows it as a suggestion; if accepted the transcript is sent to the
 * full canvas agent for actual execution.
 */
export async function handleVoicePrompt(request: Request, env: Environment): Promise<Response> {
	if (!env.OPENAI_API_KEY) {
		return Response.json({ error: 'OPENAI_API_KEY is not configured' }, { status: 500 })
	}

	let body: { transcript?: string; shapes?: ShapeStub[] }
	try {
		body = (await request.json()) as typeof body
	} catch {
		return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
	}

	const transcript = body.transcript?.trim()
	if (!transcript) {
		return Response.json({ error: 'Missing transcript' }, { status: 400 })
	}

	const shapes = body.shapes ?? []
	const canvasDescription =
		shapes.length === 0
			? 'The canvas is empty.'
			: `The canvas has ${shapes.length} shape(s): ` +
			  shapes.map((s) => `${s.type} at (${s.x},${s.y}) size ${s.w}×${s.h}`).join('; ') +
			  '.'

	const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY })

	const { text } = await generateText({
		model: openai('gpt-4o-mini'),
		messages: [
			{
				role: 'system',
				content:
					'You are an AI assistant for a collaborative whiteboard. ' +
					'Given a voice transcript and the current canvas state, ' +
					'describe in ONE concise sentence what canvas changes you would make. ' +
					'Be specific and action-oriented (e.g. "I will add a blue rectangle labeled…"). ' +
					'Do not ask for clarification.',
			},
			{
				role: 'user',
				content: `Canvas state: ${canvasDescription}\n\nUser said: "${transcript}"\n\nWhat will you do?`,
			},
		],
	})

	return Response.json({ description: text.trim() })
}

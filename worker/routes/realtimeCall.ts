import { IRequest } from 'itty-router'
import { Environment } from '../environment'

const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls'

/** JSON for multipart `session` field (same shape as OpenAI WebRTC unified-interface examples). */
function realtimeVoiceSessionJson() {
	return JSON.stringify({
		type: 'realtime',
		model: 'gpt-realtime',
		output_modalities: ['audio'],
		instructions:
			'You are a helpful voice assistant for a collaborative whiteboard. Reply in spoken audio. ' +
			'Whenever the user wants anything drawn, sketched, added, moved, edited, or changed on the canvas, you MUST call the delegate_prompt tool with a single clear instruction string (the canvas agent cannot hear you). ' +
			'For pure conversation with no canvas change, answer without the tool.',
		audio: {
			output: { voice: 'marin' },
			input: {
				turn_detection: {
					type: 'server_vad',
					create_response: true,
					interrupt_response: true,
				},
			},
		},
		tools: [
			{
				type: 'function',
				name: 'delegate_prompt',
				description:
					'REQUIRED for any canvas change: drawing, shapes, text, arrows, colors, layout, or edits. Pass one concise instruction for the drawing agent.',
				parameters: {
					type: 'object',
					properties: {
						prompt: { type: 'string', description: 'Instructions for the canvas agent.' },
					},
					required: ['prompt'],
				},
			},
		],
		tool_choice: 'auto',
	})
}

/**
 * Proxies browser WebRTC offer (SDP) to OpenAI using the unified Realtime calls API.
 * The API key stays on the worker; avoids CORS and keeps session + model aligned.
 */
export async function realtimeCall(request: IRequest, env: Environment) {
	if (!env.OPENAI_API_KEY) {
		return new Response('OPENAI_API_KEY is not configured', { status: 500 })
	}

	const sdp = await request.text()
	if (!sdp?.trim()) {
		return new Response('Expected SDP body', { status: 400 })
	}

	const fd = new FormData()
	fd.set('sdp', sdp)
	fd.set('session', realtimeVoiceSessionJson())

	const upstream = await fetch(REALTIME_CALLS_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.OPENAI_API_KEY}`,
		},
		body: fd,
	})

	const answer = await upstream.text()
	if (!upstream.ok) {
		return new Response(answer, {
			status: upstream.status,
			headers: {
				'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
			},
		})
	}

	return new Response(answer, {
		status: 200,
		headers: { 'Content-Type': 'application/sdp' },
	})
}

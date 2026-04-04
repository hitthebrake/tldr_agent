import { IRequest } from 'itty-router'
import { Environment } from '../environment'

/** GA Realtime WebRTC tokens; `/realtime/sessions` returns beta secrets that mismatch `/realtime/calls`. */
const REALTIME_CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets'

const REQUEST_BODY = {
	expires_after: {
		anchor: 'created_at' as const,
		seconds: 600,
	},
	session: {
		type: 'realtime' as const,
		model: 'gpt-4o-realtime-preview',
		output_modalities: ['audio'] as const,
		instructions:
			'You are a voice agent. For any drawing or canvas requests, use the delegate_prompt tool.',
		tools: [
			{
				type: 'function' as const,
				name: 'delegate_prompt',
				description: 'Sends drawing instructions to the canvas agent.',
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
	},
}

export async function session(_request: IRequest, env: Environment) {
	if (!env.OPENAI_API_KEY) {
		return Response.json({ error: { message: 'OPENAI_API_KEY is not configured' } }, { status: 500 })
	}

	const upstream = await fetch(REALTIME_CLIENT_SECRETS_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.OPENAI_API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(REQUEST_BODY),
	})

	const text = await upstream.text()
	if (!upstream.ok) {
		return new Response(text, {
			status: upstream.status,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	return new Response(text, {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	})
}

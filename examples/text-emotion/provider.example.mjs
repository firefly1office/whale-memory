// Optional adapter for the chat-completions JSON protocol. No implicit endpoint.
const url = process.env.EMOTION_API_URL
const model = process.env.EMOTION_MODEL
export const metadata = { model, temperature: 0.2, max_tokens: 2500 }
export let lastResponse = null
export async function generate(messages, { signal }) {
  lastResponse = null
  if (!url || !model || !process.env.EMOTION_API_KEY) throw Error('Configure EMOTION_API_URL, EMOTION_MODEL and EMOTION_API_KEY')
  const endpoint = new URL(url)
  if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw Error('Use HTTPS for a remote provider')
  const response = await fetch(endpoint, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.EMOTION_API_KEY },
    body: JSON.stringify({ ...metadata, messages, response_format: { type: 'json_object' } })
  })
  if (!response.ok) throw Error('Provider HTTP ' + response.status)
  const body = await response.json()
  lastResponse = { model: body.model, usage: body.usage, finishReason: body.choices?.[0]?.finish_reason, text: body.choices?.[0]?.message?.content }
  if (body.choices?.[0]?.finish_reason !== 'stop') throw Error('Incomplete provider response')
  return JSON.parse(body.choices[0].message.content)
}

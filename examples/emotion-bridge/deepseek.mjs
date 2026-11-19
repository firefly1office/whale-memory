export async function requestCompletion(messages, settings) {
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(90000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY },
    body: JSON.stringify({ ...settings, messages })
  })
  if (!r.ok) throw Error('Provider HTTP ' + r.status)
  const body = await r.json()
  const choice = body.choices[0]
  return { text: choice.message.content, finishReason: choice.finish_reason, usage: body.usage, model: body.model }
}

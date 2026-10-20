const MAX_IMAGE_CHARS = 12_000_000;

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  const reply = (statusCode, payload) => ({
    statusCode,
    headers,
    body: JSON.stringify(payload),
  });

  if (event.httpMethod !== "POST") {
    return reply(405, { error: "Método não permitido." });
  }
  if (!process.env.OPENAI_API_KEY) {
    return reply(500, { error: "O site ainda não foi configurado com a chave da API. O administrador precisa definir OPENAI_API_KEY nas variáveis de ambiente." });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return reply(400, { error: "Não foi possível ler os dados enviados." });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const image = typeof body.image === "string" ? body.image : "";
  if (!text && !image) return reply(400, { error: "Envie uma imagem ou cole uma conversa." });
  if (text.length > 30000) return reply(413, { error: "O texto é muito longo. Envie uma conversa menor (até 30 mil caracteres)." });
  if (image && (image.length > MAX_IMAGE_CHARS || !/^data:image\/(png|jpeg|webp);base64,/.test(image))) {
    return reply(400, { error: "Imagem inválida ou muito grande. Use PNG, JPG ou WebP de até 8 MB." });
  }

  const instructions = `Você é o analista de conversas do aplicativo humorístico brasileiro "Sobrou pro Beta?". Analise somente as mensagens fornecidas e evite afirmar que sabe com certeza o que alguém sente. Avalie sinais observáveis de interesse, iniciativa, reciprocidade, tom, perguntas, continuidade e sinais explícitos de desinteresse. Considere que respostas curtas podem ter várias explicações e não bastam isoladamente para concluir algo. Seja engraçado, direto e respeitoso, sem humilhar nem incentivar insistência quando houver rejeição clara.
Retorne APENAS um objeto JSON válido com exatamente estes campos:
{"score": número inteiro de 0 a 100, "verdict": "frase curta e engraçada em português brasileiro", "summary": "resumo de 1 a 3 frases", "reasons": ["3 a 5 sinais observáveis, cada um curto"], "transcript": "transcrição legível com Pessoa 1: e Pessoa 2: quando possível; em texto manual preserve os rótulos originais"}
score é um índice humorístico de sinais aparentes, não probabilidade real de amor nem medida científica. Faixas: 0–30 sinais muito desfavoráveis; 31–70 mistos/inconclusivos; 71–100 sinais favoráveis. Não invente mensagens que não aparecem. Se houver ambiguidade sobre os interlocutores, declare isso na transcrição. Responda em português brasileiro.`;

  const content = [{ type: "input_text", text: instructions }];
  if (text) content.push({ type: "input_text", text: "Conversa fornecida pelo usuário:\n" + text });
  if (image) content.push({ type: "input_image", image_url: image, detail: "high" });

  try {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: [{ role: "user", content }],
        max_output_tokens: 1200,
      }),
    });

    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error("OpenAI API error", upstream.status, JSON.stringify(result).slice(0, 1500));
      if (upstream.status === 401) return reply(502, { error: "A chave da API foi recusada. O administrador precisa conferir OPENAI_API_KEY." });
      if (upstream.status === 429) return reply(502, { error: "A API atingiu um limite ou está sem créditos. Confira o uso e o faturamento da API." });
      return reply(502, { error: "O serviço de IA não conseguiu concluir a análise. Tente novamente em instantes." });
    }

    const outputText = (result.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text || "")
      .join("\n")
      .trim();

    if (!outputText) return reply(502, { error: "A IA retornou uma resposta vazia. Tente novamente." });
    let parsed;
    try {
      const cleaned = outputText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Could not parse model JSON", outputText.slice(0, 1000));
      return reply(502, { error: "A resposta da IA veio em um formato inesperado. Tente novamente." });
    }

    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
    return reply(200, {
      score,
      verdict: String(parsed.verdict || "Veredito inconclusivo").slice(0, 180),
      summary: String(parsed.summary || "").slice(0, 700),
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 5).map(x => String(x).slice(0, 250)) : [],
      transcript: String(parsed.transcript || "").slice(0, 12000),
    });
  } catch (error) {
    console.error("Function error", error && error.message);
    return reply(502, { error: "Não foi possível conectar ao serviço de IA. Verifique a configuração do site e tente novamente." });
  }
};

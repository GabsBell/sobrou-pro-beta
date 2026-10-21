
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

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return reply(500, {
      error:
        "O administrador precisa configurar GEMINI_API_KEY nas variáveis de ambiente do Netlify.",
    });
  }

  let body;

  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return reply(400, {
      error: "Não foi possível ler os dados enviados.",
    });
  }

  const text =
    typeof body.text === "string" ? body.text.trim() : "";

  const image =
    typeof body.image === "string" ? body.image : "";

  if (!text && !image) {
    return reply(400, {
      error: "Envie uma imagem ou cole uma conversa.",
    });
  }

  if (text.length > 30000) {
    return reply(413, {
      error:
        "O texto é muito longo. Envie uma conversa menor, com até 30 mil caracteres.",
    });
  }

  let imagePart = null;

  if (image) {
    const match = image.match(
      /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/
    );

    if (!match || image.length > MAX_IMAGE_CHARS) {
      return reply(400, {
        error:
          "Imagem inválida ou muito grande. Use PNG, JPG ou WebP de até 8 MB.",
      });
    }

    const mimeType =
      match[1] === "jpg" ? "image/jpeg" : `image/${match[1]}`;

    imagePart = {
      inline_data: {
        mime_type: mimeType,
        data: match[2],
      },
    };
  }

  const instructions = `
Você é o analista de conversas do aplicativo humorístico
brasileiro "Será se Sobra?".

Analise somente as mensagens fornecidas. Não afirme saber
com certeza o que alguém sente.

Avalie sinais observáveis de interesse, iniciativa,
reciprocidade, tom, perguntas, continuidade e sinais
explícitos de desinteresse.

Respostas curtas podem ter várias explicações e não bastam,
isoladamente, para concluir algo.

Seja engraçado, direto e respeitoso. Não humilhe ninguém
nem incentive insistência diante de uma rejeição clara.

Retorne somente um objeto JSON válido com estes campos:
{
  "score": número inteiro de 0 a 100,
  "verdict": "frase curta e engraçada em português brasileiro",
  "summary": "resumo de 1 a 3 frases",
  "reasons": [
    "3 a 5 sinais observáveis, cada um curto"
  ],
  "transcript": "transcrição legível usando Pessoa 1: e Pessoa 2: quando possível"
}

O score é um índice humorístico de sinais aparentes.
Não é uma probabilidade real de amor nem uma medida científica.

Faixas:
0 a 30: sinais muito desfavoráveis;
31 a 70: sinais mistos ou inconclusivos;
71 a 100: sinais favoráveis.

Não invente mensagens que não aparecem.
Se houver ambiguidade sobre os interlocutores, declare isso
na transcrição.

Em texto digitado, preserve os rótulos originais dos
interlocutores, quando existirem.

Responda em português brasileiro.
`;

  const parts = [
    {
      text:
        instructions +
        (text
          ? "\n\nConversa fornecida pelo usuário:\n" + text
          : "\nAnalise a conversa presente na imagem enviada."),
    },
  ];

  if (imagePart) {
    parts.push(imagePart);
  }

  try {
    const upstream = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts,
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                score: { type: "INTEGER" },
                verdict: { type: "STRING" },
                summary: { type: "STRING" },
                reasons: {
                  type: "ARRAY",
                  items: { type: "STRING" },
                },
                transcript: { type: "STRING" },
              },
              required: [
                "score",
                "verdict",
                "summary",
                "reasons",
                "transcript",
              ],
            },
          },
        }),
      }
    );

    const result = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      console.error(
        "Gemini API error:",
        upstream.status,
        JSON.stringify(result).slice(0, 1000)
      );

      if (upstream.status === 400) {
        return reply(502, {
          error:
            "O Gemini recusou os dados enviados. Confira a imagem ou tente uma conversa menor.",
        });
      }

      if (upstream.status === 401 || upstream.status === 403) {
        return reply(502, {
          error:
            "A chave do Gemini foi recusada ou não tem permissão. Confira GEMINI_API_KEY no Netlify.",
        });
      }

      if (upstream.status === 429) {
        return reply(502, {
          error:
            "O limite de uso do Gemini foi atingido. Aguarde um pouco e tente novamente.",
        });
      }

      return reply(502, {
        error:
          "O Gemini não conseguiu concluir a análise. Tente novamente em instantes.",
      });
    }

    const outputText = (
      result.candidates?.[0]?.content?.parts || []
    )
      .map((part) => part.text || "")
      .join("\n")
      .trim();

    if (!outputText) {
      return reply(502, {
        error:
          "O Gemini retornou uma resposta vazia. Tente novamente.",
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(outputText);
    } catch {
      console.error(
        "Não foi possível interpretar o JSON do Gemini:",
        outputText.slice(0, 1000)
      );

      return reply(502, {
        error:
          "A resposta da IA veio em formato inesperado. Tente novamente.",
      });
    }

    const rawScore = Number(parsed.score);
    const score = Number.isFinite(rawScore)
      ? Math.max(0, Math.min(100, Math.round(rawScore)))
      : 0;

    return reply(200, {
      score,
      verdict: String(
        parsed.verdict || "Veredito inconclusivo"
      ).slice(0, 180),

      summary: String(parsed.summary || "").slice(0, 700),

      reasons: Array.isArray(parsed.reasons)
        ? parsed.reasons
            .slice(0, 5)
            .map((item) => String(item).slice(0, 250))
        : [],

      transcript: String(parsed.transcript || "").slice(0, 12000),
    });
  } catch (error) {
    console.error(
      "Erro na função:",
      error && error.message
    );

    return reply(502, {
      error:
        "Não foi possível conectar ao Gemini. Verifique a configuração e tente novamente.",
    });
  }
};

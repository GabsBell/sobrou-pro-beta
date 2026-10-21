
const MAX_IMAGE_CHARS = 12_000_000;
const MAX_ATTEMPTS = 3;

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
        "A chave do Gemini não está configurada no Netlify.",
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
      error: "Envie uma conversa com até 30 mil caracteres.",
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

    imagePart = {
      inline_data: {
        mime_type: `image/${match[1]}`,
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

Respostas curtas podem ter várias explicações.
Seja engraçado, direto e respeitoso. Não humilhe ninguém
nem incentive insistência diante de rejeição clara.

Retorne somente JSON válido com estes campos:
{
  "score": número inteiro de 0 a 100,
  "verdict": "frase curta e engraçada em português brasileiro",
  "summary": "resumo de 1 a 3 frases",
  "reasons": ["3 a 5 sinais observáveis"],
  "transcript": "transcrição legível com Pessoa 1: e Pessoa 2: quando possível"
}

O score é humorístico, não uma probabilidade real de amor
nem uma medida científica.

Faixas:
0 a 30: sinais muito desfavoráveis;
31 a 70: sinais mistos ou inconclusivos;
71 a 100: sinais favoráveis.

Não invente mensagens. Se houver ambiguidade sobre os
interlocutores, declare isso na transcrição.
Em texto digitado, preserve os rótulos originais.
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

  const requestBody = {
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
  };

  const retryableStatuses = new Set([
    429, 500, 502, 503, 504,
  ]);

  let lastStatus = 0;
  let lastMessage = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const upstream = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(20000),
        }
      );

      const result = await upstream.json().catch(() => ({}));

      if (!upstream.ok) {
        lastStatus = upstream.status;
        lastMessage =
          result.error?.message || "Erro desconhecido do Gemini.";

        console.error(
          "Gemini API error:",
          lastStatus,
          lastMessage,
          "Tentativa:",
          attempt
        );

        if (
          retryableStatuses.has(lastStatus) &&
          attempt < MAX_ATTEMPTS
        ) {
          await sleep(1000 * attempt);
          continue;
        }

        if (lastStatus === 400) {
          return reply(502, {
            error:
              "O Gemini não aceitou a solicitação. Tente outro print ou uma imagem menor.",
          });
        }

        if (lastStatus === 401 || lastStatus === 403) {
          return reply(502, {
            error:
              "A chave do Gemini foi recusada ou não tem permissão. Confira a configuração no Netlify.",
          });
        }

        if (lastStatus === 429) {
          return reply(502, {
            error:
              "O Gemini atingiu o limite de uso. Aguarde um pouco e tente novamente.",
          });
        }

        if (lastStatus === 503 || lastStatus === 504) {
          return reply(502, {
            error:
              "O Gemini está sobrecarregado no momento. Tentamos novamente, mas o serviço continua indisponível. Aguarde um pouco e tente outra vez.",
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
        console.error(
          "Resposta vazia do Gemini:",
          JSON.stringify(result).slice(0, 1500)
        );

        return reply(502, {
          error:
            "O Gemini retornou uma resposta vazia. Tente novamente.",
        });
      }

      let parsed;

      try {
        const cleaned = outputText
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "");

        parsed = JSON.parse(cleaned);
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

      if (
        typeof parsed.score !== "number" ||
        !Array.isArray(parsed.reasons)
      ) {
        console.error("Resposta do Gemini com campos inválidos.");

        return reply(502, {
          error:
            "A resposta da IA está incompleta. Tente novamente.",
        });
      }

      const score = Math.max(
        0,
        Math.min(100, Math.round(parsed.score))
      );

      return reply(200, {
        score,
        verdict: String(
          parsed.verdict || "Veredito inconclusivo"
        ).slice(0, 180),
        summary: String(parsed.summary || "").slice(0, 700),
        reasons: parsed.reasons
          .slice(0, 5)
          .map((item) => String(item).slice(0, 250)),
        transcript: String(
          parsed.transcript || ""
        ).slice(0, 12000),
      });
    } catch (error) {
      lastMessage = error?.message || "Erro de conexão";

      console.error(
        "Falha na comunicação com o Gemini:",
        lastMessage,
        "Tentativa:",
        attempt
      );

      if (attempt < MAX_ATTEMPTS) {
        await sleep(1000 * attempt);
        continue;
      }
    }
  }

  console.error(
    "Análise não concluída após as tentativas:",
    lastStatus,
    lastMessage
  );

  return reply(502, {
    error:
      "Não foi possível concluir a análise após algumas tentativas. O Gemini pode estar ocupado ou instável. Aguarde um pouco e tente novamente.",
  });
};


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

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return reply(500, {
      error:
        "A chave da Groq não está configurada na Netlify. Confira GROQ_API_KEY nas variáveis de ambiente.",
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

  if (image && image.length > MAX_IMAGE_CHARS) {
    return reply(413, {
      error:
        "Imagem muito grande. Use PNG, JPG ou WebP de até 8 MB.",
    });
  }

  if (
    image &&
    !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
      image
    )
  ) {
    return reply(400, {
      error: "Imagem inválida. Use PNG, JPG ou WebP.",
    });
  }

  const instructions = `
Você é o analista de conversas do aplicativo humorístico
brasileiro "Será se Sobra?".

Analise somente as mensagens fornecidas. Não afirme saber
com certeza o que alguém sente.

Avalie sinais observáveis de interesse, iniciativa,
reciprocidade, tom, perguntas, continuidade e sinais
explícitos de desinteresse.

Considere o contexto completo, a ordem das mensagens,
emojis, ironia e respostas anteriores. Não interprete
automaticamente uma resposta curta como rejeição.
Não confunda brincadeira, amizade e interesse romântico
sem considerar as evidências disponíveis.

Seja engraçado, direto e respeitoso. Não humilhe ninguém
nem incentive insistência diante de rejeição clara.

Retorne somente um objeto JSON válido com estes campos:
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

  const userContent = [
    {
      type: "text",
      text:
        instructions +
        (text
          ? "\n\nConversa fornecida pelo usuário:\n" + text
          : "\nAnalise a conversa presente na imagem enviada."),
    },
  ];

  if (image) {
    userContent.push({
      type: "image_url",
      image_url: { url: image },
    });
  }

  const requestBody = {
    model: "qwen/qwen3.8-27b",
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
    max_completion_tokens: 1800,
    reasoning_effort: "none",
  };

  let lastStatus = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const upstream = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(25000),
        }
      );

      const result = await upstream.json().catch(() => ({}));

      if (!upstream.ok) {
        lastStatus = upstream.status;

        console.error(
          "Groq API error:",
          lastStatus,
          result.error?.message || "Erro desconhecido",
          "Tentativa:",
          attempt
        );

        if (
          [500, 502, 503, 504].includes(lastStatus) &&
          attempt < MAX_ATTEMPTS
        ) {
          await sleep(1000 * attempt);
          continue;
        }

        if (lastStatus === 401 || lastStatus === 403) {
          return reply(502, {
            error:
              "A chave da Groq foi recusada ou não tem permissão. Confira GROQ_API_KEY na Netlify.",
          });
        }

        if (lastStatus === 429) {
          return reply(429, {
            error:
              "A Groq atingiu o limite de uso. Aguarde a cota liberar e tente novamente.",
          });
        }

        if ([500, 502, 503, 504].includes(lastStatus)) {
          return reply(502, {
            error:
              "A Groq está temporariamente indisponível. Aguarde um pouco e tente novamente.",
          });
        }

        if (lastStatus === 400) {
          return reply(502, {
            error:
              "A Groq não aceitou a solicitação. Tente outro print ou uma imagem menor.",
          });
        }

        return reply(502, {
          error:
            "Não foi possível concluir a análise com a Groq. Tente novamente.",
        });
      }

      const outputText =
        result.choices?.[0]?.message?.content?.trim();

      if (!outputText) {
        console.error("Resposta vazia da Groq.");

        return reply(502, {
          error:
            "A Groq retornou uma resposta vazia. Tente novamente.",
        });
      }

      let parsed;

      try {
        parsed = JSON.parse(
          outputText
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "")
        );
      } catch {
        console.error(
          "JSON inválido recebido da Groq:",
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
        return reply(502, {
          error:
            "A resposta da IA está incompleta. Tente novamente.",
        });
      }

      return reply(200, {
        score: Math.max(
          0,
          Math.min(100, Math.round(parsed.score))
        ),
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
      console.error(
        "Falha de comunicação com a Groq:",
        error?.message || "Erro de conexão",
        "Tentativa:",
        attempt
      );

      if (attempt < MAX_ATTEMPTS) {
        await sleep(1000 * attempt);
        continue;
      }
    }
  }

  return reply(502, {
    error:
      "Não foi possível concluir a análise após algumas tentativas. Aguarde e tente novamente.",
  });
};

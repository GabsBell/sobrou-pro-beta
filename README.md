# Sobrou pro Beta? — Site responsivo com IA

Este projeto funciona como um site responsivo para celular e desktop. A interface é HTML/CSS/JavaScript e a análise real acontece numa Netlify Function (Node.js), mantendo a chave da OpenAI no servidor. Não precisa instalar Python.

## O que inclui
- Envio de print (PNG/JPG/WebP, até 8 MB) para análise visual por IA.
- Análise de conversa em texto.
- Veredito, índice humorístico de 0 a 100, sinais observados e transcrição.
- Os seis memes originais enviados pelo usuário, alternados conforme o resultado.
- Layout responsivo para mobile e desktop.
- Mensagens de erro para chave ausente, API sem créditos/limite e falhas de conexão.

## Publicar na internet (sem Python)

### 1. Criar um repositório no GitHub
1. Entre em https://github.com e crie um repositório novo, por exemplo `sobrou-pro-beta`.
2. Envie para ele todos os arquivos e pastas deste projeto.

### 2. Publicar com Netlify
1. Entre em https://www.netlify.com/ e conecte sua conta do GitHub.
2. Escolha **Add new site / Import an existing project** e selecione o repositório.
3. Configure o publish directory como `public`. O arquivo `netlify.toml` já define a configuração de build e functions.
4. Nas configurações do site, abra **Environment variables** e adicione:
   - Nome: `OPENAI_API_KEY`
   - Valor: sua chave secreta da OpenAI API
   Opcional: `OPENAI_MODEL` com um modelo de visão compatível disponível na sua conta; por padrão é `gpt-4.1-mini`.
5. Faça o deploy. Abra o endereço `*.netlify.app` que a plataforma fornecer.

**Nunca coloque a chave da API no HTML/JavaScript do navegador ou em repositório público.** Defina-a apenas nas variáveis de ambiente da função hospedada.

## Testar localmente (opcional; não requer Python)
Instale Node.js LTS, depois na pasta do projeto:
```bash
npm install
npx netlify dev
```
Abra o endereço local indicado pelo Netlify CLI. Para a análise real, defina `OPENAI_API_KEY` no ambiente local antes de iniciar.

## Custos e privacidade
- A OpenAI API é cobrada separadamente da assinatura do ChatGPT. É preciso ter acesso e faturamento/créditos válidos na API.
- O print ou texto enviado é transmitido à API para análise. Oriente usuários a ocultarem nomes, telefones e outros dados pessoais.
- O índice é humorístico e não deve ser tratado como uma avaliação científica de sentimentos.
- O projeto não armazena intencionalmente conversas em banco de dados. Os dados são enviados à função e à API durante a análise.

## Limitação
O projeto está preparado para deploy, mas não foi publicado na sua conta nem testado com uma chave real. Para ter um link público, é necessário concluir o deploy no Netlify e configurar a chave.

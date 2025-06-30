import fetch from "node-fetch";
import { createFFmpeg } from "@ffmpeg/ffmpeg";
import OpenAI from "openai";

export default async function handler(req, res) {
  // 1) Permitir CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "Falta url" });

    // 2) Bajar el video
    const videoResp = await fetch(url);
    if (!videoResp.ok) throw new Error(`Error al bajar video: ${videoResp.status}`);
    const videoData = await videoResp.arrayBuffer();

    // 3) Extraer audio con FFmpeg WASM
    const ffmpeg = createFFmpeg({ log: false });
    await ffmpeg.load();
    ffmpeg.FS("writeFile", "video.mp4", new Uint8Array(videoData));
    await ffmpeg.run("-i", "video.mp4", "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "audio.wav");
    const audioData = ffmpeg.FS("readFile", "audio.wav");

    // 4) Transcribir con Whisper
    const whisper = new OpenAI({ apiKey: process.env.WHISPER_API_KEY });
    const transcription = await whisper.transcriptions.create({
      model: "whisper-1",
      file: audioData.buffer
    });

    // 5) Resumir con GPT-4
    const gpt = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const chat = await gpt.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Devuelve sólo JSON." },
        {
          role: "user",
          content: `
Del siguiente texto:
${transcription.text}

Genera un JSON con:
1. "summary": 2–3 frases en español.
2. "tags": array de 3–6 palabras clave en minúsculas.
          `.trim()
        }
      ]
    });
    const output = JSON.parse(chat.choices[0].message.content);
    return res.json(output);

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}

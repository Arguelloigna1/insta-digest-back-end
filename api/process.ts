import fetch from "node-fetch";
import { createFFmpeg } from "@ffmpeg/ffmpeg";
import OpenAI from "openai";

export default async function handler(req, res) {
  // Permitir peticiones desde cualquier origen
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "Falta url" });

    // 1) Descarga el vídeo
    const videoResp = await fetch(url);
    if (!videoResp.ok) throw new Error(`Error al bajar video: ${videoResp.status}`);
    const videoData = await videoResp.arrayBuffer();

    // 2) Carga FFmpeg en memoria
    const ffmpeg = createFFmpeg({ log: false });
    await ffmpeg.load();
    ffmpeg.FS("writeFile", "video.mp4", new Uint8Array(videoData));

    // 3) Extrae audio a WAV
    await ffmpeg.run("-i", "video.mp4", "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "audio.wav");
    const audioData = ffmpeg.FS("readFile", "audio.wav");

    // 4) Transcribe con Whisper
    const whisper = new OpenAI({ apiKey: process.env.WHISPER_API_KEY });
    const t = await whisper.transcriptions.create({
      model: "whisper-1",
      file: audioData.buffer
    });

    // 5) Resume con GPT-4
    const gpt = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const chat = await gpt.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Devuelve solo JSON." },
        {
          role: "user",
          content: `

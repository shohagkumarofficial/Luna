# Luna - AI Voice Assistant

A cute Bengali AI voice companion (Express + WebSocket server, React + Vite client).

## API key
Open the app, tap the settings icon, and paste your free Gemini API key
(from https://aistudio.google.com/apikey) into **Gemini API Key**.
The key is stored only in your browser and sent per request. No server env var is required.

## Run locally
```bash
npm install
npm run dev      # http://localhost:3000
```

## Deploy on Render (free)
1. Fork/import this repo on https://render.com -> New -> Blueprint (uses `render.yaml`),
   or create a Web Service manually.
2. Build command: `npm install --include=dev && npm run build`
3. Start command: `npm start`
4. Open the site and add your API key from Settings.

Note: the free plan sleeps after ~15 minutes idle (first load can take about a minute).

## Voice engines (priority order)
1. **ElevenLabs** (optional): add your key in Settings. Bengali needs model `eleven_v3` (default).
2. **Gemini TTS** (needs a project where Gemini TTS is enabled/billed; a 403 in the Log panel means it is not).
3. **Edge TTS** (free fallback, only two Bengali voices).

Open the **Log** button in the app to see which engine produced each voice and why a fallback happened.

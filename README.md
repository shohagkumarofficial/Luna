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

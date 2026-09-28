// Game video streamer using Xvfb + Wine + periodic screenshots
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

let xvfbProc = null;
let wineProc = null;
let captureTimer = null;
let displayNum = 99;
let streamClients = [];
let frameBuffer = null;
let frameTimestamp = 0;
let gameStreamStarted = false;
const FRAME_PATH = '/tmp/game_frame.jpg';
const INPUT_QUEUE = [];

function cleanup() {
  console.log('[STREAM] Cleaning up processes...');
  if (captureTimer) { clearInterval(captureTimer); }
  if (wineProc) { try { wineProc.kill('SIGKILL'); } catch(e) {} }
  if (xvfbProc) { try { xvfbProc.kill('SIGKILL'); } catch(e) {} }
  gameStreamStarted = false;
}

function startGameStream() {
  if (gameStreamStarted) return;
  gameStreamStarted = true;
  console.log('[STREAM] Starting game stream...');

  if (!fs.existsSync(`/tmp/.X11-unix/X${displayNum}`)) {
    xvfbProc = spawn('Xvfb', [`:${displayNum}`, '-screen', '0', '1920x1080x24', '-ac']);
    xvfbProc.once('error', error => {
      console.error('[STREAM] Xvfb failed to start:', error.message);
      gameStreamStarted = false;
    });
    console.log('[STREAM] Xvfb starting on :' + displayNum);
  } else {
    console.log('[STREAM] Reusing display :' + displayNum);
  }
  
  // Wait for display, then start game
  setTimeout(() => {
    const env = { ...process.env, DISPLAY: `:${displayNum}` };
    wineProc = spawn('wine', [
      'Chameleon/Binaries/Win64/PenguinHotel-Win64-Shipping.exe',
      '-windowed'
    ], { env, cwd: '/workspaces/TomatoSuperSeedApplePenTwoThousand/MECCHA CHAMELEON' });
    
    wineProc.once('error', error => {
      console.error('[STREAM] Wine failed to start:', error.message);
      gameStreamStarted = false;
    });
    wineProc.stdout.on('data', (d) => console.log('[WINE]', d.toString().trim()));
    wineProc.stderr.on('data', (d) => console.error('[WINE ERR]', d.toString().trim()));
    console.log('[STREAM] Wine game process started');
  }, 1000);
  
  // Start periodic screenshot capture after game launches
  setTimeout(() => {
    startCaptureLoop();
  }, 5000);
}

function startCaptureLoop() {
  console.log('[STREAM] Starting capture loop...');
  
  captureTimer = setInterval(() => {
    captureFrame();
  }, 1000); // 1 FPS for now, can increase later
  
  // Capture first frame immediately
  captureFrame();
}

function captureFrame() {
  try {
    spawn('ffmpeg', [
      '-y',
      '-f', 'x11grab',
      '-video_size', '1920x1080',
      '-i', `:${displayNum}.0`,
      '-frames:v', '1',
      '-update', '1',
      FRAME_PATH
    ], { timeout: 3000 });
    
    // Read the frame and broadcast to clients
    setTimeout(() => {
      if (fs.existsSync(FRAME_PATH)) {
        const data = fs.readFileSync(FRAME_PATH);
        frameBuffer = data;
        frameTimestamp = Date.now();
        
        // Send to all connected stream clients
        for (const client of streamClients) {
          try {
            if (!client.destroyed && !client.finished) {
              client.write('data: ' + data.toString('base64') + '\n\n');
            }
          } catch(e) {}
        }
      }
    }, 500);
  } catch(e) {
    console.error('[STREAM] Capture error:', e.message);
  }
}

function spawnInputCommand(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('xdotool', args);
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`xdotool exited with code ${code}`));
    });
  });
}

// HTTP endpoint for Server-Sent Events stream of base64 frames
function handleStreamRequest(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  // Send initial frame if available
  if (frameBuffer) {
    res.write('data: ' + frameBuffer.toString('base64') + '\n\n');
  } else {
    res.write('data: LOADING\n\n');
  }
  
  streamClients.push(res);
  
  req.on('close', () => {
    streamClients = streamClients.filter(c => c !== res);
  });
}

// HTTP endpoint to send input events to game
async function handleInputRequest(req, res) {
  const input = req.body;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return res.status(400).json({ error: 'Expected a JSON object' });
  }

  try {
    if (input.type === 'key' && typeof input.key === 'string') {
      await spawnInputCommand(['keydown', input.key]);
      setTimeout(() => {
        spawnInputCommand(['keyup', input.key]).catch(error => console.error('[INPUT] Key release failed:', error.message));
      }, 100);
    } else if (input.type === 'click') {
      await spawnInputCommand(['click', String(input.button || '1')]);
    } else if (input.type === 'move') {
      await spawnInputCommand(['mousemove', String(input.x), String(input.y)]);
    } else {
      return res.status(400).json({ error: 'Unsupported input type' });
    }
  } catch (error) {
    console.error('[INPUT] Delivery failed:', error.message);
    return res.status(503).json({ error: 'Game input is unavailable' });
  }

  INPUT_QUEUE.push(input);
  res.json({ status: 'ok' });
}

export default { startGameStream, handleStreamRequest, handleInputRequest, cleanup };

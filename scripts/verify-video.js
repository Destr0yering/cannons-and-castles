const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const videoPath = path.resolve(
  process.argv[2] || path.join(root, 'outputs', 'Cannons-and-Castles-Devpost-Demo-55s.mp4'),
);

function fail(message) {
  console.error(JSON.stringify({ status: 'fail', file: videoPath, error: message }, null, 2));
  process.exitCode = 1;
}

if (!fs.existsSync(videoPath)) {
  fail('Video file does not exist.');
  return;
}

const stat = fs.statSync(videoPath);
const bytes = fs.readFileSync(videoPath);
const codecs = {
  h264: bytes.includes(Buffer.from('avc1')),
  aac: bytes.includes(Buffer.from('mp4a')),
};

const server = http.createServer((request, response) => {
  if (request.url !== '/video.mp4') {
    response.writeHead(404).end();
    return;
  }

  const range = request.headers.range;
  if (!range) {
    response.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(videoPath).pipe(response);
    return;
  }

  const [startText, endText] = range.replace('bytes=', '').split('-');
  const start = Number(startText);
  const end = endText ? Number(endText) : stat.size - 1;
  response.writeHead(206, {
    'Content-Type': 'video/mp4',
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges': 'bytes',
  });
  fs.createReadStream(videoPath, { start, end }).pipe(response);
});

server.listen(0, '127.0.0.1', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<video id="audit" preload="auto" muted src="http://127.0.0.1:${server.address().port}/video.mp4"></video>`,
    );
    const playback = await page.locator('#audit').evaluate(async (video) => {
      const mediaError = () => video.error
        ? { code: video.error.code, message: video.error.message }
        : null;
      await new Promise((resolve, reject) => {
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return resolve();
        video.addEventListener('loadedmetadata', resolve, { once: true });
        video.addEventListener(
          'error',
          () => reject(new Error(JSON.stringify(mediaError()))),
          { once: true },
        );
      });

      const checkpoints = [0, video.duration / 2, Math.max(0, video.duration - 0.25)];
      for (const seconds of checkpoints) {
        video.currentTime = seconds;
        await new Promise((resolve, reject) => {
          video.addEventListener('seeked', resolve, { once: true });
          video.addEventListener(
            'error',
            () => reject(new Error(JSON.stringify(mediaError()))),
            { once: true },
          );
        });
      }

      video.currentTime = 0;
      await video.play();
      await new Promise((resolve) => setTimeout(resolve, 750));
      video.pause();
      return {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        readyState: video.readyState,
        networkState: video.networkState,
        error: mediaError(),
        audioDecodedBytes: video.webkitAudioDecodedByteCount ?? 0,
        videoDecodedFrames: video.webkitDecodedFrameCount ?? 0,
        checkpoints,
      };
    });

    const result = {
      status: 'pass',
      file: videoPath,
      bytes: stat.size,
      codecs,
      ...playback,
    };
    const failures = [];
    if (Math.abs(result.duration - 55) > 0.05) failures.push(`duration ${result.duration}s is not 55s`);
    if (result.width !== 1920 || result.height !== 1080) {
      failures.push(`resolution ${result.width}x${result.height} is not 1920x1080`);
    }
    if (!result.codecs.h264 || !result.codecs.aac) failures.push('expected H.264/AAC sample entries');
    if (result.error) failures.push(`media error ${JSON.stringify(result.error)}`);
    if (result.audioDecodedBytes <= 0) failures.push('audio stream did not decode');
    if (result.videoDecodedFrames <= 0) failures.push('video stream did not decode');
    if (failures.length) {
      result.status = 'fail';
      result.failures = failures;
      process.exitCode = 1;
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.stack || error.message : String(error));
  } finally {
    await browser.close();
    server.close();
  }
});

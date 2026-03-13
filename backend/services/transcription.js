/**
 * Transcription Service
 *
 * Uses faster-whisper Python package via child_process to transcribe audio files.
 * Same pattern as the scraper service.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Transcribe an audio file using faster-whisper
 * @param {string} audioPath - Absolute path to the audio file
 * @param {string} modelSize - Whisper model size: tiny, base, small, medium (default: base)
 * @returns {Promise<{transcript: string, duration: number}>}
 */
async function transcribeAudio(audioPath, modelSize = 'base') {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  // Python script that transcribes with speaker turn detection.
  // Uses silence gaps (>0.8s) between segments to infer speaker changes.
  // Labels alternating speakers as Speaker 1 / Speaker 2.
  // The AI analysis prompt then identifies which is Garrett vs. the prospect.
  const pythonScript = `
import sys
import json

try:
    from faster_whisper import WhisperModel
except ImportError:
    print(json.dumps({"error": "faster-whisper not installed. Run: pip install faster-whisper"}))
    sys.exit(1)

audio_path = sys.argv[1]
model_size = sys.argv[2] if len(sys.argv) > 2 else "base"

try:
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        audio_path,
        beam_size=5,
        vad_filter=True,
        vad_parameters=dict(
            min_silence_duration_ms=500,
            speech_pad_ms=200,
        ),
    )

    # Collect all segments with timestamps
    raw_segments = []
    for seg in segments:
        text = seg.text.strip()
        if text:
            raw_segments.append({
                "start": round(seg.start, 2),
                "end": round(seg.end, 2),
                "text": text,
            })

    if not raw_segments:
        print(json.dumps({"transcript": "", "duration": round(info.duration)}))
        sys.exit(0)

    # Detect speaker turns by silence gaps between segments.
    # A gap > TURN_GAP seconds likely means the other person started talking.
    TURN_GAP = 0.8
    current_speaker = 1
    turns = []
    current_turn_texts = [raw_segments[0]["text"]]
    current_turn_start = raw_segments[0]["start"]

    for i in range(1, len(raw_segments)):
        gap = raw_segments[i]["start"] - raw_segments[i - 1]["end"]
        if gap >= TURN_GAP:
            # Speaker change
            turns.append({
                "speaker": current_speaker,
                "start": current_turn_start,
                "text": " ".join(current_turn_texts),
            })
            current_speaker = 2 if current_speaker == 1 else 1
            current_turn_texts = [raw_segments[i]["text"]]
            current_turn_start = raw_segments[i]["start"]
        else:
            # Same speaker continues
            current_turn_texts.append(raw_segments[i]["text"])

    # Don't forget the last turn
    turns.append({
        "speaker": current_speaker,
        "start": current_turn_start,
        "text": " ".join(current_turn_texts),
    })

    # Format as readable transcript with speaker labels and timestamps
    def fmt_time(seconds):
        m = int(seconds) // 60
        s = int(seconds) % 60
        return f"{m}:{s:02d}"

    lines = []
    for t in turns:
        lines.append(f"[{fmt_time(t['start'])}] Speaker {t['speaker']}: {t['text']}")

    transcript = "\\n".join(lines)
    duration = round(info.duration)

    result = {
        "transcript": transcript,
        "duration": duration,
    }
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
`;

  return new Promise((resolve, reject) => {
    const proc = spawn('python', ['-c', pythonScript, audioPath, modelSize], {
      cwd: path.join(__dirname, '..'),
      timeout: 300000 // 5 minute timeout for transcription
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        try {
          const lines = stdout.trim().split('\n');
          const result = JSON.parse(lines[lines.length - 1]);
          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve({
              transcript: result.transcript || '',
              duration: result.duration || 0
            });
          }
        } catch (e) {
          reject(new Error(`Failed to parse transcription output: ${e.message}`));
        }
      } else {
        reject(new Error(`Transcription failed (code ${code}): ${stderr || 'Unknown error'}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start transcription process: ${err.message}`));
    });
  });
}

module.exports = {
  transcribeAudio
};

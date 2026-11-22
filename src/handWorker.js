import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
let detector = null;
self.import = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  (0, eval)(await response.text());
};
async function init({ base }) {
  const files = await FilesetResolver.forVisionTasks(`${base}mediapipe`);
  const options = {
    baseOptions: { modelAssetPath: `${base}models/hand_landmarker.task`, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.4
  };
  try {
    detector = await HandLandmarker.createFromOptions(files, options);
  } catch {
    options.baseOptions.delegate = "CPU";
    detector = await HandLandmarker.createFromOptions(files, options);
  }
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      await init(data);
      self.postMessage({ type: "ready" });
    } else if (data.type === "frame") {
      const started = performance.now();
      let result;
      try {
        result = detector.detectForVideo(data.bitmap, data.timestamp);
      } finally {
        data.bitmap.close();
      }
      const { landmarks, worldLandmarks, handedness, handednesses } = result;
      self.postMessage({
        type: "result",
        captured: data.captured,
        inference: performance.now() - started,
        result: { landmarks, worldLandmarks, handedness: handedness ?? handednesses }
      });
    } else if (data.type === "close") {
      detector?.close();
      detector = null;
    }
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message ?? String(error) });
  }
};

# Surface Kiosk — remote face-recognition service

Runs face recognition off the Surface (e.g. on a Mac mini) so the Surface GPU is
free. The kiosk relays infrared frames over WebSocket; this service enhances,
detects, matches against enrolled descriptors, and returns `{personId, box}`.

## Run
```
npm install
# copy face-api model files into ./models (tiny_face_detector, face_landmark_68,
# face_recognition manifests + .bin)
PORT=8770 npm start
```

Protocol (WS, JSON):
- client → `{type:"configure", people:[{id, displayName, descriptors:[[128]]}], matchThreshold}`
- client → `{type:"frame", dataUrl, infrared:true, at}` → server `{type:"result", present, personId, displayName, distance, box, ms}`
- client → `{type:"describe", dataUrl, infrared:true, id}` → server `{type:"described", id, present, descriptor}` (enrollment)

Node ≥23 removed some `util` type helpers tfjs uses; `node-compat.mjs` shims them.

"""
╔══════════════════════════════════════════════════════════════╗
║         PLANTA — FastAPI Backend (app.py)                 ║
║    ConvNeXt-Tiny · Grad-CAM · Upload + ESP-32 IP Camera      ║
╚══════════════════════════════════════════════════════════════╝
Run:  uvicorn app:app --host 0.0.0.0 --port 8000 --reload
"""
import os
import io
import base64
import csv      # FIXED: Added missing import
import pathlib

import cv2
import numpy as np
import requests
import tensorflow as tf
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image


# ─────────────────────────────────────────────────────────────
# APP INIT + CORS
# ─────────────────────────────────────────────────────────────
app = FastAPI(
    title="Planta Plant Disease API",
    description="ConvNeXt-Tiny inference with Grad-CAM visualisation",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],      # Allow all origins (local HTML, ESP-32, etc.)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────────────────────
MODEL_PATH     = "convnext_plant_disease.keras"   # FIXED: Relative path for HF/Local
CLASS_CSV_PATH = "class_dict.csv"
IMG_SIZE       = (224, 224)

# ConvNeXt last convolutional block name for Grad-CAM
GRADCAM_LAYER  = "convnext_tiny"

# Pulls from variables, defaults to local router IP if not found
ESP32_URL = os.getenv("ESP32_CAPTURE_URL", "http://10.161.93.232/capture")


# ─────────────────────────────────────────────────────────────
# LOAD CLASS DICTIONARY & BUILD PLANT GROUPS
# ─────────────────────────────────────────────────────────────
class_map: dict[int, str] = {}
plant_groups: dict[str, list[int]] = {}

try:
    # FIXED: Added quotes around "class_dict.csv"
    with open("class_dict.csv", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            idx = int(row["class_index"])
            label = row["class"].replace("___", " – ").replace("_", " ")
            class_map[idx] = label
            
            # Extract just the plant name (e.g., "Tomato" from "Tomato – Early blight")
            plant_name = label.split(" – ")[0].strip()
            
            if plant_name not in plant_groups:
                plant_groups[plant_name] = []
            plant_groups[plant_name].append(idx)
            
    print(f"[INFO] Loaded {len(class_map)} classes across {len(plant_groups)} plant species.")
except FileNotFoundError:
    print(f"[WARNING] class_dict.csv not found — class names will fall back to indices.")


# ─────────────────────────────────────────────────────────────
# LOAD KERAS MODEL (TF 2.16+ Keras 3 Native)
# ─────────────────────────────────────────────────────────────
model: tf.keras.Model = None  # type: ignore

try:
    # FIXED: Added quotes around "convnext_plant_disease.keras"
    model = tf.keras.models.load_model("convnext_plant_disease.keras", compile=False)
    print(f"[INFO] SUCCESS: Model loaded natively from convnext_plant_disease.keras")
except Exception as exc:
    print(f"[ERROR] Native load failed: {exc}")
    try:
        # Fallback to safe mode override if needed
        model = tf.keras.models.load_model("convnext_plant_disease.keras", compile=False, safe_mode=False)
        print("[INFO] SUCCESS: Model loaded via safe_mode override.")
    except Exception as exc2:
        print(f"[CRITICAL] All loading methods failed: {exc2}")


# ─────────────────────────────────────────────────────────────
# IMAGE PREPROCESSING
# ─────────────────────────────────────────────────────────────
def preprocess_image(pil_img: Image.Image) -> np.ndarray:
    img = pil_img.convert("RGB").resize(IMG_SIZE, Image.LANCZOS)
    arr = np.array(img, dtype=np.float32)          # (224, 224, 3)  range [0, 255]
    arr = np.expand_dims(arr, axis=0)               # (1, 224, 224, 3)
    return arr


# ─────────────────────────────────────────────────────────────
# GRAD-CAM
# ─────────────────────────────────────────────────────────────
def _find_gradcam_layer(mdl: tf.keras.Model) -> tf.keras.layers.Layer:
    # 1. Exact name match at top level
    for layer in mdl.layers:
        if layer.name == GRADCAM_LAYER:
            return layer

    # 2. Search inside nested sub-models
    for layer in mdl.layers:
        if isinstance(layer, tf.keras.Model):
            for sub in layer.layers:
                if sub.name == GRADCAM_LAYER:
                    return sub

    # 3. Fallback: last Conv2D or DepthwiseConv2D
    target = None
    for layer in mdl.layers:
        if isinstance(layer, tf.keras.layers.InputLayer):
            continue
        if isinstance(layer, (tf.keras.layers.Conv2D, tf.keras.layers.DepthwiseConv2D)):
            target = layer

    # 4. Broader fallback
    if target is None:
        for layer in mdl.layers:
            if isinstance(layer, tf.keras.layers.InputLayer):
                continue
            try:
                shape = layer.output_shape
                if isinstance(shape, list): shape = shape[0]
                if len(shape) == 4: target = layer
            except Exception:
                continue

    if target is None:
        raise ValueError("No suitable Conv layer found for Grad-CAM.")
    return target


def _heatmap_to_b64(pil_img: Image.Image, heatmap: np.ndarray) -> str:
    orig_w, orig_h = pil_img.size
    heatmap_resized = cv2.resize(heatmap, (orig_w, orig_h))
    heatmap_uint8   = np.uint8(255 * heatmap_resized)
    heatmap_colored = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)
    orig_bgr = cv2.cvtColor(np.array(pil_img.convert("RGB")), cv2.COLOR_RGB2BGR)
    superimposed = cv2.addWeighted(orig_bgr, 0.60, heatmap_colored, 0.40, 0)
    _, buffer = cv2.imencode(".jpg", superimposed, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    return base64.b64encode(buffer).decode("utf-8")


def compute_gradcam(pil_img: Image.Image, preprocessed: np.ndarray, pred_class_idx: int) -> str:
    if model is None:
        raise RuntimeError("Model not loaded.")

    img_tensor = tf.cast(preprocessed, tf.float32)

    try:
        gradcam_layer = _find_gradcam_layer(model)
        grad_model = tf.keras.models.Model(
            inputs=model.inputs,
            outputs=[gradcam_layer.output, model.output],
        )

        with tf.GradientTape() as tape:
            conv_outputs, predictions = grad_model(img_tensor)
            class_score = predictions[:, pred_class_idx]

        grads       = tape.gradient(class_score, conv_outputs)
        pooled      = tf.reduce_mean(grads, axis=(0, 1, 2))
        feature_map = conv_outputs[0]
        heatmap     = tf.squeeze(tf.nn.relu(feature_map @ pooled[..., tf.newaxis])).numpy()

        if heatmap.max() > 0:
            heatmap /= heatmap.max()

        return _heatmap_to_b64(pil_img, heatmap)

    except Exception as exc:
        img_var = tf.Variable(img_tensor)
        with tf.GradientTape() as tape:
            preds      = model(img_var, training=False)
            class_score = preds[:, pred_class_idx]

        grads   = tape.gradient(class_score, img_var)
        heatmap = tf.reduce_mean(tf.abs(grads[0]), axis=-1)
        heatmap = tf.nn.relu(heatmap).numpy()
        if heatmap.max() > 0: heatmap /= heatmap.max()
        return _heatmap_to_b64(pil_img, heatmap)


# ─────────────────────────────────────────────────────────────
# SHARED INFERENCE PIPELINE
# ─────────────────────────────────────────────────────────────
def run_inference(pil_img: Image.Image, selected_plant: str = "Auto") -> dict:
    if model is None:
        raise RuntimeError("Model is not loaded.")

    preprocessed = preprocess_image(pil_img)
    predictions  = model.predict(preprocessed, verbose=0)[0]

    if selected_plant != "Auto" and selected_plant in plant_groups:
        allowed_indices = plant_groups[selected_plant]
        mask = np.zeros_like(predictions)
        mask[allowed_indices] = 1.0
        predictions = predictions * mask

    pred_idx    = int(np.argmax(predictions))
    total_allowed_prob = np.sum(predictions)
    confidence = (float(predictions[pred_idx]) / total_allowed_prob * 100.0) if total_allowed_prob > 0 else 0.0

    disease_raw = class_map.get(pred_idx, f"Class_{pred_idx}")
    gradcam_b64 = ""
    try:
        gradcam_b64 = compute_gradcam(pil_img, preprocessed, pred_idx)
    except Exception:
        pass

    return {
        "disease":        disease_raw,
        "confidence":     round(confidence, 2),
        "gradcam_base64": gradcam_b64,
    }


# ─────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────
@app.post("/predict_upload")
async def predict_upload(file: UploadFile = File(...), plant: str = Form("Auto")):
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image.")
    try:
        raw_bytes = await file.read()
        pil_img   = Image.open(io.BytesIO(raw_bytes))
        result    = run_inference(pil_img, selected_plant=plant)
        return JSONResponse(content=result)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@app.post("/predict_esp32")
async def predict_esp32(plant: str = Form("Auto")):
    if not ESP32_URL:
        raise HTTPException(status_code=503, detail="ESP-32 not configured.")
    try:
        resp = requests.get(ESP32_URL, timeout=5)
        resp.raise_for_status()
        img_array = np.frombuffer(resp.content, dtype=np.uint8)
        img_bgr   = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(img_rgb)
        result  = run_inference(pil_img, selected_plant=plant)
        return JSONResponse(content=result)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": model is not None}

@app.get("/", include_in_schema=False)
async def serve_root():
    return FileResponse("index.html")

@app.get("/dashboard.html", include_in_schema=False)
async def serve_dashboard():
    return FileResponse("dashboard.html")

app.mount("/", StaticFiles(directory=".", html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
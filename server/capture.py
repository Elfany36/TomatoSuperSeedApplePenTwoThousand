import pyautogui
import time
import base64
from io import BytesIO
from PIL import Image

def capture_frame():
    """Capture current screen frame and return as base64 JPEG"""
    screenshot = pyautogui.screenshot()
    buffered = BytesIO()
    screenshot.save(buffered, format="JPEG", quality=80)
    img_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
    return img_base64

if __name__ == "__main__":
    time.sleep(2)  # Wait for game to start
    while True:
        frame = capture_frame()
        print(f"Captured frame: {len(frame)} bytes")
        time.sleep(0.1)

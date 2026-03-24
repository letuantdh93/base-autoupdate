import subprocess
import time
import tkinter as tk
from tkinter import filedialog

def select_app_path():
    root = tk.Tk()
    root.withdraw()  # Ẩn cửa sổ chính
    root.attributes('-topmost', True)  # Đưa lên trên cùng
    
    file_path = filedialog.askopenfilename(
        title="Chọn ứng dụng cần chạy",
        filetypes=[("Executable files", "*.exe"), ("All files", "*.*")]
    )
    
    root.destroy()
    return file_path

# Chọn đường dẫn tới app cần chạy
APP_PATH = select_app_path()
if not APP_PATH:
    print("Không chọn file nào. Thoát chương trình.")
    exit()

print(f"Đã chọn ứng dụng: {APP_PATH}")

RUN_TIME = 5 * 60      # 5 phút (giây)
CYCLE_TIME = 10 * 60   # 10 phút (giây)

while True:
    print("▶️ Mở ứng dụng...")
    
    process = subprocess.Popen(APP_PATH)

    # Cho app chạy 5 phút
    time.sleep(RUN_TIME)

    print("⛔ Đóng ứng dụng...")
    process.terminate()  # thử đóng mềm
    
    # Nếu app không chịu đóng, dùng:
    # process.kill()

    # Nghỉ cho đủ chu kỳ 10 phút
    remaining_time = CYCLE_TIME - RUN_TIME
    if remaining_time > 0:
        time.sleep(remaining_time)
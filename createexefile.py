import subprocess
import time

# Đường dẫn tới app cần chạy
APP_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
# Nếu là file exe khác thì đổi đường dẫn

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
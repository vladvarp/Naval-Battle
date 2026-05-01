import os
import re
from pathlib import Path

# Пути
SCRIPT_DIR = Path(__file__).parent
AUDIO_DIR = SCRIPT_DIR / "audio"
INDEX_FILE = SCRIPT_DIR / "index.html"

# Проверки
if not AUDIO_DIR.exists():
    print("❌ Папка 'audio' не найдена рядом со скриптом!")
    exit(1)
if not INDEX_FILE.exists():
    print("❌ Файл index.html не найден рядом со скриптом!")
    exit(1)

def count_mp3_files(folder_path: str) -> int:
    """Считаем только .mp3 файлы в папке (без подпапок)"""
    try:
        return len([f for f in os.listdir(folder_path) if f.lower().endswith('.mp3')])
    except:
        return 0

# Собираем количество файлов по всем подпапкам audio/
folder_counts = {}
for folder_name in os.listdir(AUDIO_DIR):
    full_path = AUDIO_DIR / folder_name
    if full_path.is_dir():
        count = count_mp3_files(full_path)
        folder_counts[folder_name] = count
        print(f"📁 {folder_name} → {count} mp3")

# Читаем index.html
content = INDEX_FILE.read_text(encoding="utf-8")
updated = 0

# Регулярка обновляет только цифру в makeFiles(X)
pattern = r'(\{\s*id:\s*"[^"]+")[^}]*?(folder:\s*"audio/([^"]+)")[^}]*?(files:\s*makeFiles\(\d+\))'

def replace_files(match):
    global updated
    full_match = match.group(0)
    folder_name = match.group(3)          # из folder: "audio/XXX"
    old_files_part = match.group(4)       # files: makeFiles(число)

    new_count = folder_counts.get(folder_name, 0)

    # Находим старое число
    old_count_match = re.search(r'makeFiles\((\d+)\)', old_files_part)
    old_count = int(old_count_match.group(1)) if old_count_match else 0

    if new_count != old_count:
        updated += 1
        print(f"✅ Обновлено: {folder_name} → {old_count} → {new_count}")
        # Заменяем только часть makeFiles(число)
        new_files_part = old_files_part.replace(f"makeFiles({old_count})", f"makeFiles({new_count})")
        return full_match.replace(old_files_part, new_files_part)
    return full_match

content = re.sub(pattern, replace_files, content)

# Сохраняем, если были изменения
if updated > 0:
    INDEX_FILE.write_text(content, encoding="utf-8")
    print(f"\n🎉 Готово! Обновлено {updated} записей в AUDIO_EVENTS")
else:
    print("\n✅ Всё уже актуально, ничего менять не пришлось")

print("\nСкрипт завершён.")
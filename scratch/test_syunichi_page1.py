import os

downloads_dir = "C:\\Users\\auand\\Downloads"
print("Listing Downloads containing Syunichi:")
for name in os.listdir(downloads_dir):
    if "syunichi" in name.lower():
        print(f"- {name} (bytes: {os.path.getsize(os.path.join(downloads_dir, name))})")

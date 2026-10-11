import sys, os, time, json, subprocess
import numpy as np

# Test runner that runs isolated subprocesses to test raw determinism
def main():
    fixtures = [
        ('manga1', 'public/fixtures/ocr/manga/manga1.png'),
        ('manga3', 'public/fixtures/ocr/manga/manga3.png'),
        ('document2', 'public/fixtures/ocr/document_test/document2.png'),
    ]

    os.makedirs('scratch/determinism', exist_ok=True)
    
    # 1. Run 5 separate processes for DML
    runs_dml = {}
    for fid, img_path in fixtures:
        runs_dml[fid] = []
        for i in range(5):
            out_file = f"scratch/determinism/{fid}_dml_run{i+1}.json"
            cmd = [
                sys.executable,
                "tests/single_raw_run.py",
                "--image", img_path,
                "--backend", "dml",
                "--out", out_file
            ]
            subprocess.run(cmd, check=True)
            with open(out_file, 'r', encoding='utf-8') as f:
                runs_dml[fid].append(json.load(f))
                
    # 2. Run 1 reference run for CPU
    runs_cpu = {}
    for fid, img_path in fixtures:
        runs_cpu[fid] = []
        out_file = f"scratch/determinism/{fid}_cpu_ref.json"
        cmd = [
            sys.executable,
            "tests/single_raw_run.py",
            "--image", img_path,
            "--backend", "cpu",
            "--out", out_file
        ]
        subprocess.run(cmd, check=True)
        with open(out_file, 'r', encoding='utf-8') as f:
            runs_cpu[fid].append(json.load(f))

    # Analyze stability per backend
    def analyze_stability(runs_dict, backend_name):
        print(f"\n==================================================")
        print(f"STABILITY ANALYSIS: {backend_name.upper()} (5 Isolated Runs)")
        print(f"==================================================")
        for fid in ['manga1', 'manga3', 'document2']:
            runs = runs_dict[fid]
            ref = runs[0]['lines']
            print(f"\n--- {fid} ({len(ref)} lines in Run 1) ---")
            unstable_lines = []
            max_score_diff = 0.0
            max_coord_diff = 0.0
            
            for r_idx in range(1, 5):
                curr = runs[r_idx]['lines']
                if len(curr) != len(ref):
                    print(f"  [WARN] Run {r_idx+1} line count mismatch: {len(curr)} vs {len(ref)}")
                min_len = min(len(curr), len(ref))
                for l_idx in range(min_len):
                    t_ref = ref[l_idx]['text']
                    s_ref = ref[l_idx]['score']
                    b_ref = np.array(ref[l_idx]['box'])
                    
                    t_cur = curr[l_idx]['text']
                    s_cur = curr[l_idx]['score']
                    b_cur = np.array(curr[l_idx]['box'])
                    
                    s_diff = abs(s_ref - s_cur)
                    c_diff = np.max(np.abs(b_ref - b_cur))
                    if s_diff > max_score_diff: max_score_diff = s_diff
                    if c_diff > max_coord_diff: max_coord_diff = c_diff
                    
                    if t_ref != t_cur or s_diff > 0.001 or c_diff > 0.5:
                        unstable_lines.append({
                            "line_idx": l_idx,
                            "run": r_idx + 1,
                            "ref_text": t_ref,
                            "cur_text": t_cur,
                            "ref_score": s_ref,
                            "cur_score": s_cur,
                            "coord_diff": float(c_diff)
                        })
            if not unstable_lines:
                print(f"  PERFECTLY STABLE (100% deterministic across all 5 runs)")
                print(f"  Max score diff: {max_score_diff:.6f}, Max coord diff: {max_coord_diff:.6f} px")
            else:
                print(f"  Found {len(unstable_lines)} unstable events:")
                for ev in unstable_lines[:5]:
                    print(f"    Line {ev['line_idx']} (Run {ev['run']}): '{ev['ref_text']}' vs '{ev['cur_text']}' (coord diff: {ev['coord_diff']:.2f}px)")

    analyze_stability(runs_dml, "DML")
    analyze_stability(runs_cpu, "CPU")

if __name__ == '__main__':
    main()

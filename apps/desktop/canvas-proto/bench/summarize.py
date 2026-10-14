import sys,json
for l in open(sys.argv[1]):
    l=l.strip()
    if not l.startswith('{'):
        if l: print(l[:200])
        continue
    try: o=json.loads(l)
    except Exception: print('trunc', l[:150]); continue
    p,d=o['play'],o['drag']
    print(f"{o['app']:6} {o['show']:7} {o['backend']:11} x{o['throttle']} n={o['marchers']:4} | play {p['fps']:5} p95 {p['p95']:6} max {p['max']:6} >50ms {p['over50ms']:3} | drag {d['fps']:5} p95 {d['p95']:6} max {d['max']:6} >50ms {d['over50ms']:3} moved {o.get('movedDuringDrag')} moves {o.get('dragMoves')} | t {o.get('timeBeforePlay')}->{o.get('timeDuringPlay')}")

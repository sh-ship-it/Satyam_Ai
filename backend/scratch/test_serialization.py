import time
from pydantic import BaseModel

class TrendPoint(BaseModel):
    period: str
    crime_type: str
    district: str
    count: int

def main():
    # Simulate 39,745 rows
    rows = [
        {
            "period": "2025-12",
            "crime_type": "CYBER CRIME",
            "district": "Bengaluru City",
            "count": 68
        }
        for _ in range(39745)
    ]
    
    t0 = time.time()
    # Pydantic v2 (FastAPI uses Pydantic)
    points = [TrendPoint(**r) for r in rows]
    t1 = time.time()
    print(f"Pydantic instantiation of {len(rows)} objects took {t1 - t0:.3f} seconds.")
    
    # Serialize to dict
    t2 = time.time()
    dicts = [p.model_dump() for p in points]
    t3 = time.time()
    print(f"Pydantic serialization to dict took {t3 - t2:.3f} seconds.")

if __name__ == "__main__":
    main()

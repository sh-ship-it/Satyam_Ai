"""Synthetic KSP-style crime data generator.

IMPORTANT (spec risk R4): this is SYNTHETIC data. It exists to demo the pipeline,
not to validate model accuracy — do not draw real-world conclusions from it.
Deterministic seed keeps demos reproducible.
"""
from __future__ import annotations

import datetime as dt
import random

DISTRICTS = [
    ("Bengaluru Central", "KA-BLR", 12.9716, 77.5946),
    ("Bengaluru South", "KA-BLR", 12.9081, 77.5712),
    ("Mysuru", "KA-MYS", 12.2958, 76.6394),
    ("Mangaluru", "KA-DK", 12.9141, 74.8560),
    ("Hubballi", "KA-DWD", 15.3647, 75.1240),
]
CRIME_TYPES = [
    "Theft", "Burglary", "Assault", "Fraud", "Cyber Crime",
    "Vehicle Theft", "Robbery", "Missing Person",
]
IPC = {
    "Theft": "IPC 379", "Burglary": "IPC 457", "Assault": "IPC 351",
    "Fraud": "IPC 420", "Cyber Crime": "IT Act 66", "Vehicle Theft": "IPC 379",
    "Robbery": "IPC 392", "Missing Person": "CrPC 174",
}
STATUSES = ["Open", "Under Investigation", "Charge-sheeted", "Closed"]
ROLES = ["Complainant", "Accused", "Witness", "Victim"]
FIRST = ["Arjun", "Priya", "Ravi", "Anita", "Suresh", "Deepa", "Kiran", "Lakshmi",
         "Manoj", "Geetha", "Vikram", "Shwetha"]
LAST = ["Kumar", "Reddy", "Gowda", "Shetty", "Rao", "Hegde", "Naik", "Patil"]


def generate(*, n_cases: int = 120, n_persons: int = 80, seed: int = 42) -> dict:
    rng = random.Random(seed)
    stations, officers = [], []
    for i, (dist, jur, lat, lng) in enumerate(DISTRICTS):
        sid = f"PS{i+1:02d}"
        stations.append({"station_id": sid, "name": f"{dist} PS", "zone": jur,
                         "district": dist, "lat": lat, "lng": lng})
        for j in range(2):
            officers.append({"officer_id": f"{sid}-O{j+1}",
                             "name": f"{rng.choice(FIRST)} {rng.choice(LAST)}",
                             "rank": rng.choice(["SI", "PSI", "Inspector"]),
                             "station_id": sid})

    persons = [
        {"person_id": f"P{idx:04d}",
         "name": f"{rng.choice(FIRST)} {rng.choice(LAST)}",
         "age": rng.randint(18, 70), "gender": rng.choice(["M", "F"]),
         "role_type": rng.choice(ROLES)}
        for idx in range(1, n_persons + 1)
    ]

    cases, case_persons, narratives = [], [], []
    base = dt.date(2025, 1, 1)
    for k in range(1, n_cases + 1):
        dist, jur, lat, lng = rng.choice(DISTRICTS)
        ctype = rng.choice(CRIME_TYPES)
        sid = f"PS{DISTRICTS.index((dist, jur, lat, lng))+1:02d}"
        fir = f"FIR-2025-{k:04d}"
        sensitivity = rng.choices([0, 1, 2], weights=[80, 15, 5])[0]
        cases.append({
            "fir_no": fir,
            "date": (base + dt.timedelta(days=rng.randint(0, 300))).isoformat(),
            "ipc_sections": IPC[ctype], "crime_type": ctype,
            "status": rng.choice(STATUSES), "station_id": sid,
            "lat": lat + rng.uniform(-0.05, 0.05), "lng": lng + rng.uniform(-0.05, 0.05),
            "district": dist, "zone": jur, "sensitivity_flag": sensitivity,
            "jurisdiction_id": jur,
        })
        for _ in range(rng.randint(1, 4)):
            p = rng.choice(persons)
            case_persons.append({"case_id": fir, "person_id": p["person_id"],
                                 "role": rng.choice(ROLES)})
        narratives.append({
            "case_id": fir,
            "text": (f"On {cases[-1]['date']}, a {ctype.lower()} was reported in "
                     f"{dist}. The complainant stated that the incident occurred "
                     f"near a public area. Investigation is {cases[-1]['status'].lower()}."),
        })

    return {"stations": stations, "officers": officers, "persons": persons,
            "cases": cases, "case_persons": case_persons, "narratives": narratives}


if __name__ == "__main__":
    import json

    print(json.dumps(generate(), indent=2)[:2000])

import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
API_KEY = "ctk_live_victor_dev_key"
HEADERS = {"X-API-Key": API_KEY}

def test_health_check():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"

def test_get_user_profile():
    response = client.get("/v1/auth/me", headers=HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "victor"
    assert data["height_cm"] == 185.0
    assert "estimated_bmr" in data

def test_patch_user_profile():
    response = client.patch(
        "/v1/auth/me",
        json={"target_rate_kg_per_week": -0.75},
        headers=HEADERS
    )
    assert response.status_code == 200
    data = response.json()
    assert data["target_rate_kg_per_week"] == -0.75

def test_dashboard_summary():
    response = client.get("/v1/dashboard/summary?date=2026-09-17", headers=HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["date"] == "2026-09-17"
    assert "trend_weight" in data
    assert "tdee" in data

def test_dashboard_trends():
    response = client.get("/v1/dashboard/trends?days=14", headers=HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0

def test_idempotent_weight_log():
    event_id = "test_evt_weight_123"
    payload = {"date": "2026-09-17", "raw_weight": 85.5, "client_event_id": event_id}
    
    res1 = client.post("/v1/weight", json=payload, headers=HEADERS)
    assert res1.status_code == 200
    w1 = res1.json()["raw_weight"]

    res2 = client.post("/v1/weight", json=payload, headers=HEADERS)
    assert res2.status_code == 200
    w2 = res2.json()["raw_weight"]

    assert w1 == w2 == 85.5

def test_food_interpretation():
    payload = {"text": "Ate 2 eggs and a slice of toast", "client_event_id": "test_food_456"}
    res = client.post("/v1/food/interpret", json=payload, headers=HEADERS)
    assert res.status_code == 200
    data = res.json()
    assert "logged_meals" in data
    assert len(data["logged_meals"]) > 0

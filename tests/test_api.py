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
    assert "target_monthly_rate_kg" in data
    assert "min_daily_calories" in data


def test_patch_user_profile_goals():
    response = client.patch(
        "/v1/auth/me",
        json={"target_weight_kg": 85.0, "target_monthly_rate_kg": -2.5, "min_daily_calories": 1600.0},
        headers=HEADERS,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["target_weight_kg"] == 85.0
    assert data["target_monthly_rate_kg"] == -2.5
    assert data["min_daily_calories"] == 1600.0


def test_safety_floor_enforcement():
    # Set an extreme negative monthly rate (-10 kg/month) to force safety floor cap
    res = client.patch(
        "/v1/auth/me", json={"target_monthly_rate_kg": -10.0, "min_daily_calories": 1600.0}, headers=HEADERS
    )
    assert res.status_code == 200

    summary_res = client.get("/v1/dashboard/summary?date=2026-09-17", headers=HEADERS)
    assert summary_res.status_code == 200
    summary = summary_res.json()
    assert summary["target_calories"] == 1600.0
    assert summary["is_rate_capped_by_safety_floor"] is True

    # Revert to realistic -2.0 kg/month
    client.patch(
        "/v1/auth/me",
        json={"target_monthly_rate_kg": -2.0, "target_weight_kg": 85.0, "min_daily_calories": 1500.0},
        headers=HEADERS,
    )


def test_dashboard_summary_and_projections():
    response = client.get("/v1/dashboard/summary?date=2026-09-17", headers=HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["date"] == "2026-09-17"
    assert data["target_weight_kg"] == 85.0
    assert data["target_monthly_rate_kg"] == -2.0
    assert "projected_date_target_rate" in data
    assert "projected_date_actual_rate" in data


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


def test_batch_meal_logging_and_catalog_search():
    payload = {
        "client_event_id": "test_batch_food_789",
        "meals": [
            {
                "date": "2026-09-19",
                "food_name": "5 4-inch homemade pancakes",
                "canonical_name": "Pancake, homemade",
                "serving_size": "5 pancakes",
                "calories": 400.0,
                "protein": 10.0,
                "carbs": 65.0,
                "fat": 8.0,
            },
            {
                "date": "2026-09-19",
                "food_name": "30g butter",
                "canonical_name": "Butter, salted",
                "serving_size": "30g",
                "calories": 215.0,
                "protein": 0.2,
                "carbs": 0.0,
                "fat": 24.0,
            },
        ],
    }

    res = client.post("/v1/food/meals", json=payload, headers=HEADERS)
    assert res.status_code == 201
    items = res.json()
    assert len(items) == 2
    assert items[0]["canonical_name"] == "Pancake, homemade"
    assert items[1]["canonical_name"] == "Butter, salted"

    # Verify search endpoint with FTS5 token search
    search_res = client.get("/v1/food/search?q=pancakes", headers=HEADERS)
    assert search_res.status_code == 200
    catalog = search_res.json()
    assert len(catalog) > 0
    assert catalog[0]["canonical_name"] == "Pancake, homemade"
    assert catalog[0]["usage_count"] >= 1


def test_protected_openapi_and_docs():
    # Unauthenticated requests should return 401
    res_openapi_unauth = client.get("/openapi.json")
    assert res_openapi_unauth.status_code == 401

    res_docs_unauth = client.get("/docs")
    assert res_docs_unauth.status_code == 401

    # Authenticated requests should return 200
    res_openapi_auth = client.get("/openapi.json", headers=HEADERS)
    assert res_openapi_auth.status_code == 200
    assert "paths" in res_openapi_auth.json()

    res_docs_auth = client.get("/docs", headers=HEADERS)
    assert res_docs_auth.status_code == 200
    assert "text/html" in res_docs_auth.headers.get("content-type", "")


def test_bulk_file_import_json_and_gzip():
    import gzip
    import json

    import_data_obj = {
        "weights": [{"date": "2026-08-01", "raw_weight": 88.5}, {"date": "2026-08-02", "raw_weight": 88.2}],
        "meals": [
            {
                "date": "2026-08-01",
                "food_name": "Oatmeal with berries",
                "canonical_name": "Oatmeal",
                "serving_size": "1 bowl",
                "calories": 350.0,
                "protein": 12.0,
                "carbs": 60.0,
                "fat": 5.0,
            }
        ],
    }
    json_bytes = json.dumps(import_data_obj).encode("utf-8")

    # Test uncompressed .json import
    res_json = client.post(
        "/v1/import/file", files={"file": ("migration_data.json", json_bytes, "application/json")}, headers=HEADERS
    )
    assert res_json.status_code == 200
    data_json = res_json.json()
    assert data_json["status"] == "success"
    assert data_json["weights_imported"] == 2
    assert data_json["meals_imported"] == 1

    # Test compressed .json.gz import
    gz_bytes = gzip.compress(json_bytes)
    res_gz = client.post(
        "/v1/import/file", files={"file": ("migration_data.json.gz", gz_bytes, "application/gzip")}, headers=HEADERS
    )
    assert res_gz.status_code == 200
    data_gz = res_gz.json()
    assert data_gz["status"] == "success"
    assert data_gz["weights_imported"] == 2
    assert data_gz["meals_imported"] == 1

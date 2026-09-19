# Interactive Command Flows & Walkthroughs (`COMMAND_FLOWS.md`)

This document demonstrates example user chat conversations and the exact API tool invocations performed by the Assistant.

---

## Flow 1: Meal Logging with Confirmation

**User**: *"Ate 5 homemade pancakes, 30g butter, and 2 tbsp strawberry jam"*

**Assistant**:
1. Calculates itemized nutrition.
2. Displays Markdown breakdown table.
3. Asks: *"Does this breakdown look accurate to log?"*

**User**: *"Looks good"*

**Assistant (Tool Call 1)**:
`POST /v1/food/meals`
```json
{
  "client_event_id": "evt_meal_1726750123",
  "meals": [
    {
      "date": "2026-09-19",
      "food_name": "5 homemade 4-inch pancakes",
      "canonical_name": "Pancake, homemade",
      "serving_size": "5 pancakes",
      "calories": 400.0,
      "protein": 10.0,
      "carbs": 65.0,
      "fat": 8.0
    },
    {
      "date": "2026-09-19",
      "food_name": "30g butter (salted)",
      "canonical_name": "Butter, salted",
      "serving_size": "30g",
      "calories": 215.0,
      "protein": 0.2,
      "carbs": 0.0,
      "fat": 24.0
    },
    {
      "date": "2026-09-19",
      "food_name": "2 tbsp strawberry jam",
      "canonical_name": "Jam, strawberry",
      "serving_size": "2 tbsp",
      "calories": 110.0,
      "protein": 0.0,
      "carbs": 28.0,
      "fat": 0.0
    }
  ]
}
```

**Assistant (Tool Call 2)**:
`GET /v1/dashboard/summary?date=2026-09-19`

**Assistant Response**:
> *"Logged 725 kcal! You've consumed 1,850 kcal today out of your 2,170 kcal target budget (320 kcal remaining)."*

---

## Flow 2: Scale Weight Logging

**User**: *"Weighed 84.2 kg this morning"*

**Assistant (Tool Call 1)**:
`POST /v1/weight`
```json
{
  "date": "2026-09-19",
  "raw_weight": 84.2,
  "client_event_id": "evt_weight_1726750400"
}
```

**Assistant (Tool Call 2)**:
`GET /v1/dashboard/summary?date=2026-09-19`

**Assistant Response**:
> *"Logged 84.2 kg! Your Trend Weight is now **84.6 kg** and your estimated live TDEE is **2,675 kcal/day**."*

---

## Flow 3: Status Query & Projections

**User**: *"How am I doing today?"*

**Assistant (Tool Call 1)**:
`GET /v1/dashboard/summary?date=2026-09-19`

**Assistant Response**:
> *"Here is your summary for today (Sep 19):*
> * **Calories**: 1,850 / 2,170 kcal (320 kcal remaining)
> * **Protein**: 125g / 162g target
> * **Trend Weight**: 84.6 kg
> * **Goal Target**: 80.0 kg (-2.0 kg/month pace)
> * **Projected Goal Date (Target Rate)**: Nov 28, 2026
> * **Projected Goal Date (Actual 30d Pace)**: Dec 05, 2026"*

import os
import sys
import glob
import csv
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

# Add parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal, engine, Base
from app.db.models import UserProfile, ScaleWeight, MealLog, APIKey
from app.services.tdee import recalculate_user_tdee

def excel_date(serial):
    return (datetime(1899, 12, 30) + timedelta(days=float(serial))).strftime("%Y-%m-%d")

def read_xlsx(path):
    out = []
    with zipfile.ZipFile(path, 'r') as z:
        strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            ss_xml = z.read('xl/sharedStrings.xml')
            ss_root = ET.fromstring(ss_xml)
            for si in ss_root.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si'):
                text = ''.join([t.text for t in si.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t') if t.text])
                strings.append(text)
        
        sheet_xml = z.read('xl/worksheets/sheet1.xml')
        s_root = ET.fromstring(sheet_xml)
        rows = s_root.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row')
        for r in rows:
            row_vals = []
            for c in r.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c'):
                t = c.attrib.get('t')
                v_elem = c.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
                v = v_elem.text if v_elem is not None else ''
                if t == 's' and v.isdigit():
                    v = strings[int(v)]
                row_vals.append(v)
            out.append(row_vals)
    return out

def import_data(username="victor"):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        # Create user profile
        user = db.query(UserProfile).filter(UserProfile.username == username).first()
        if not user:
            user = UserProfile(
                username=username,
                dob="1987-12-07",
                height_cm=185.0,
                sex="male"
            )
            db.add(user)
            db.commit()

        # Create API Key
        key_obj = db.query(APIKey).filter(APIKey.username == username).first()
        if not key_obj:
            key_obj = APIKey(
                key="ctk_live_victor_dev_key",
                username=username,
                name="Victor Personal Key"
            )
            db.add(key_obj)
            db.commit()

        export_dir = "data_export_export"

        # 1. Import Scale Weights
        weight_files = glob.glob(os.path.join(export_dir, "*120624*.xlsx")) or glob.glob(os.path.join(export_dir, "*.xlsx"))
        weight_count = 0
        for wf in weight_files:
            rows = read_xlsx(wf)
            if rows and "Weight" in str(rows[0]):
                for r in rows[1:]:
                    if len(r) >= 2 and r[0] and r[1]:
                        dt_str = excel_date(r[0])
                        w_val = float(r[1])
                        
                        existing_w = db.query(ScaleWeight).filter(ScaleWeight.username == username, ScaleWeight.date == dt_str).first()
                        if not existing_w:
                            db.add(ScaleWeight(username=username, date=dt_str, raw_weight=w_val))
                            weight_count += 1
                        else:
                            existing_w.raw_weight = w_val

        db.commit()
        print(f"✅ Imported {weight_count} new scale weight entries.")

        # 2. Import Food Logs
        csv_files = glob.glob(os.path.join(export_dir, "*.csv"))
        food_count = 0
        if csv_files:
            food_file = csv_files[0]
            with open(food_file, 'r', encoding='utf-8-sig') as f:
                reader = csv.DictReader(f)
                dt_col = [k for k in reader.fieldnames if 'Date' in k][0]
                for r in reader:
                    dt_str = r[dt_col]
                    cals = float(r.get("Calories (kcal)", 0) or 0)
                    p = float(r.get("Protein (g)", 0) or 0)
                    c = float(r.get("Carbs (g)", 0) or 0)
                    f_g = float(r.get("Fat (g)", 0) or 0)

                    meal = MealLog(
                        username=username,
                        date=dt_str,
                        time=r.get("Time"),
                        food_name=r.get("Food Name", "Logged Food"),
                        serving_size=r.get("Serving Size"),
                        serving_qty=float(r.get("Serving Qty", 1.0) or 1.0),
                        serving_weight_g=float(r.get("Serving Weight (g)", 0) or 0) if r.get("Serving Weight (g)") else None,
                        calories=cals,
                        protein=p,
                        carbs=c,
                        fat=f_g
                    )
                    db.add(meal)
                    food_count += 1

            db.commit()
            print(f"✅ Imported {food_count} food log entries.")

        # 3. Recalculate TDEE & daily summaries
        print("🔄 Running TDEE engine to calculate historical trend weight & expenditures...")
        recalculate_user_tdee(db, username)
        print("🎉 Import and calculation complete!")

    finally:
        db.close()

if __name__ == "__main__":
    import_data()

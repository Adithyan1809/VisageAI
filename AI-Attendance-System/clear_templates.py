#!/usr/bin/env python3
"""Clear all facial templates from database to start fresh."""

import sys
sys.path.insert(0, '/home/adithyan/PycharmProjects/SMAP/AI-Attendance-System')

from sqlalchemy import text, create_engine
from sqlalchemy.orm import sessionmaker

# Read config to get DB URL
import yaml
with open('config.yaml', 'r') as f:
    config = yaml.safe_load(f)

db_url = config.get('DB_URL')
if not db_url:
    print("❌ DB_URL not found in config.yaml")
    sys.exit(1)

engine = create_engine(db_url)
Session = sessionmaker(bind=engine)
session = Session()

try:
    # Delete all facial templates
    result = session.execute(text("DELETE FROM facial_templates;"))
    session.commit()
    print(f"✅ Deleted {result.rowcount} facial templates")
    
    # Verify
    count = session.execute(text("SELECT COUNT(*) FROM facial_templates;")).scalar()
    print(f"✅ Cleared all facial templates. Remaining: {count}")
finally:
    session.close()
    engine.dispose()


#!/usr/bin/env python3
"""
URGENT: Deduplicate similar facial templates in the database.
This prevents false matches when multiple near-identical templates exist for the same employee.

Run this ONCE to clean up the database:
    python3 deduplicate_templates.py
"""

import asyncio
import logging
from db_utils import get_db_manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


async def deduplicate_templates():
    """Remove duplicate templates for the same employee that are too similar."""
    db = get_db_manager()
    await db.create_pool()
    
    # For each employee, find templates with similarity > 0.98 and delete duplicates
    sql = """
    WITH ranked_templates AS (
        SELECT 
            employee_id,
            id,
            created_at,
            ROW_NUMBER() OVER (PARTITION BY employee_id ORDER BY created_at DESC) AS rn,
            (
                SELECT COUNT(*) FROM facial_templates ft2 
                WHERE ft2.employee_id = facial_templates.employee_id
                AND 1 - (ft2.template_data::vector <=> facial_templates.template_data::vector) > 0.98
            ) AS duplicate_count
        FROM facial_templates
        WHERE is_active = true
    )
    SELECT id, employee_id, created_at, rn, duplicate_count
    FROM ranked_templates
    WHERE duplicate_count > 1
    ORDER BY employee_id, rn DESC;
    """
    
    async with db.pool.acquire() as conn:
        duplicates = await conn.fetch(sql)
        logger.info(f"Found {len(duplicates)} potentially duplicate templates")
        
        # Group by employee and keep only the most recent template
        employee_templates = {}
        for row in duplicates:
            emp_id = row['employee_id']
            if emp_id not in employee_templates:
                employee_templates[emp_id] = []
            employee_templates[emp_id].append(row['id'])
        
        # Delete all but the first (most recent) for each employee
        deleted = 0
        for emp_id, template_ids in employee_templates.items():
            if len(template_ids) > 1:
                # Keep the first one (most recent due to ORDER BY DESC)
                to_delete = template_ids[1:]
                logger.info(f"Employee {emp_id}: Keeping 1 template, deleting {len(to_delete)} duplicates")
                
                for tid in to_delete:
                    del_sql = "DELETE FROM facial_templates WHERE id = $1;"
                    async with db.pool.acquire() as conn2:
                        await conn2.execute(del_sql, tid)
                    deleted += 1
        
        logger.info(f"✅ Deleted {deleted} duplicate templates")
        logger.info("Database cleanup complete!")


if __name__ == "__main__":
    asyncio.run(deduplicate_templates())

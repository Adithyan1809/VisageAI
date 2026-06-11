#!/usr/bin/env python3
"""Diagnose facial template issues - check if templates are correctly aligned with employees."""

import asyncio
import sys
sys.path.insert(0, '/home/adithyan/PycharmProjects/SMAP/AI-Attendance-System')

from db_utils import DatabaseManager

async def main():
    db_manager = DatabaseManager()
    
    # Get all templates
    async with db_manager.get_session() as session:
        # Query raw templates
        query = """
        SELECT ft.id, ft.employee_id, e.name, 
               LEFT(ft.embedding_vector::text, 100) as embedding_preview,
               ft.confidence, ft.created_at
        FROM facial_templates ft
        JOIN employees e ON ft.employee_id = e.id
        ORDER BY e.name, ft.created_at DESC
        LIMIT 30
        """
        
        result = await session.execute(query)
        rows = result.fetchall()
        
        print("=== FACIAL TEMPLATE DATABASE DUMP ===\n")
        print(f"Total templates found: {len(rows)}\n")
        
        for row in rows:
            template_id, emp_id, emp_name, embedding_preview, confidence, created_at = row
            print(f"Template ID: {template_id}")
            print(f"  Employee: {emp_name} (ID: {emp_id})")
            print(f"  Confidence: {confidence}")
            print(f"  Created: {created_at}")
            print(f"  Embedding: {embedding_preview}...")
            print()

if __name__ == "__main__":
    asyncio.run(main())

"""unified level tracking migration

Revision ID: unified_level_tracking_20251119
Revises: migrate_spell_level_tracking_20251119
Create Date: 2024-11-19 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import json

# revision identifiers, used by Alembic.
revision = 'unified_level_tracking_20251119'
down_revision = 'migrate_spell_level_tracking_20251119'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Migrate all character features to use unified level tracking format.

    Converts:
    - selected_skills: ["skill1", "skill2"] -> [{"value": "skill1", "level_acquired": 1, "source": "migration"}, ...]
    - expertise_skills: ["skill1"] -> [{"value": "skill1", "level_acquired": 1, "source": "migration"}, ...]
    - fighting_style: "defense" -> {"value": "defense", "level_acquired": 1, "source": "migration"}
    - favored_enemy: "undead" -> {"value": "undead", "level_acquired": 1, "source": "ranger"}
    - favored_terrain: "forest" -> {"value": "forest", "level_acquired": 1, "source": "ranger"}
    - eldritch_invocations: ["invoc1"] -> [{"value": "invoc1", "level_acquired": 2, "source": "warlock"}, ...]

    Note: Since we don't have historical data about when features were acquired,
    we use reasonable defaults based on class rules.
    """

    # Get connection to execute raw SQL
    connection = op.get_bind()

    # Fetch all characters
    result = connection.execute(sa.text("SELECT id, class_id, level, selected_skills, expertise_skills, fighting_style, favored_enemy, favored_terrain, eldritch_invocations FROM characters"))
    characters = result.fetchall()

    for char in characters:
        char_id = char.id
        class_id = char.class_id
        level = char.level or 1
        updates = {}

        # Convert selected_skills
        if char.selected_skills:
            skills = json.loads(char.selected_skills) if isinstance(char.selected_skills, str) else char.selected_skills
            if skills and isinstance(skills, list):
                # Check if already in new format
                if not (skills and isinstance(skills[0], dict) and 'level_acquired' in skills[0]):
                    # Convert to new format
                    new_skills = []
                    for skill in skills:
                        if isinstance(skill, str):
                            new_skills.append({
                                "value": skill,
                                "level_acquired": 1,  # Assume skills from character creation
                                "source": "background_or_class"
                            })
                    updates['selected_skills'] = json.dumps(new_skills)

        # Convert expertise_skills
        if char.expertise_skills:
            expertise = json.loads(char.expertise_skills) if isinstance(char.expertise_skills, str) else char.expertise_skills
            if expertise and isinstance(expertise, list):
                # Check if already in new format
                if not (expertise and isinstance(expertise[0], dict) and 'level_acquired' in expertise[0]):
                    # Convert to new format
                    # Expertise is gained at different levels depending on class
                    # Rogue: level 1 and 6
                    # Bard: level 3 and 10
                    expertise_level = 1 if class_id == 'rogue' else 3 if class_id == 'bard' else 1
                    new_expertise = []
                    for i, skill in enumerate(expertise):
                        if isinstance(skill, str):
                            # Assume first 2 expertise at first level, rest at second expertise level
                            acquired_level = expertise_level if i < 2 else (6 if class_id == 'rogue' else 10)
                            new_expertise.append({
                                "value": skill,
                                "level_acquired": min(acquired_level, level),  # Can't be higher than current level
                                "source": class_id or "migration",
                                "source_detail": "expertise"
                            })
                    updates['expertise_skills'] = json.dumps(new_expertise)

        # Convert fighting_style
        if char.fighting_style:
            style = json.loads(char.fighting_style) if isinstance(char.fighting_style, str) else char.fighting_style
            if style:
                # Check if already in new format
                if not (isinstance(style, dict) and 'level_acquired' in style):
                    # Fighting style levels: Fighter 1, Ranger 2, Paladin 2
                    style_level = 1 if class_id == 'fighter' else 2 if class_id in ['ranger', 'paladin'] else 1
                    new_style = {
                        "value": style if isinstance(style, str) else str(style),
                        "level_acquired": min(style_level, level),
                        "source": class_id or "migration"
                    }
                    updates['fighting_style'] = json.dumps(new_style)

        # Convert favored_enemy (Ranger only)
        if char.favored_enemy:
            enemy = json.loads(char.favored_enemy) if isinstance(char.favored_enemy, str) else char.favored_enemy
            if enemy:
                # Check if already in new format
                if not (isinstance(enemy, dict) and 'level_acquired' in enemy):
                    new_enemy = {
                        "value": enemy if isinstance(enemy, str) else str(enemy),
                        "level_acquired": 1,  # Rangers get this at level 1
                        "source": "ranger"
                    }
                    updates['favored_enemy'] = json.dumps(new_enemy)

        # Convert favored_terrain (Ranger only)
        if char.favored_terrain:
            terrain = json.loads(char.favored_terrain) if isinstance(char.favored_terrain, str) else char.favored_terrain
            if terrain:
                # Check if already in new format
                if not (isinstance(terrain, dict) and 'level_acquired' in terrain):
                    new_terrain = {
                        "value": terrain if isinstance(terrain, str) else str(terrain),
                        "level_acquired": 1,  # Rangers get this at level 1
                        "source": "ranger"
                    }
                    updates['favored_terrain'] = json.dumps(new_terrain)

        # Convert eldritch_invocations (Warlock only)
        if char.eldritch_invocations:
            invocations = json.loads(char.eldritch_invocations) if isinstance(char.eldritch_invocations, str) else char.eldritch_invocations
            if invocations and isinstance(invocations, list):
                # Check if already in new format
                if not (invocations and isinstance(invocations[0], dict) and 'level_acquired' in invocations[0]):
                    # Warlocks get invocations at levels 2, 5, 7, 9, 12, 15, 18
                    invocation_levels = [2, 5, 7, 9, 12, 15, 18]
                    new_invocations = []
                    for i, invoc in enumerate(invocations):
                        if isinstance(invoc, str):
                            # Distribute invocations across the levels they could have been gained
                            acquired_level = invocation_levels[min(i // 2, len(invocation_levels) - 1)] if i < len(invocation_levels) * 2 else 18
                            new_invocations.append({
                                "value": invoc,
                                "level_acquired": min(acquired_level, level),
                                "source": "warlock"
                            })
                    updates['eldritch_invocations'] = json.dumps(new_invocations)

        # Apply updates if any
        if updates:
            set_clause = ', '.join([f"{col} = :{col}" for col in updates.keys()])
            update_sql = f"UPDATE characters SET {set_clause} WHERE id = :char_id"
            params = {**updates, 'char_id': char_id}
            connection.execute(sa.text(update_sql), params)

    print(f"Migration complete: Updated {len(characters)} characters to use unified level tracking")


def downgrade() -> None:
    """
    Revert characters to simple string/array format.

    Note: This will lose level tracking information.
    """

    # Get connection to execute raw SQL
    connection = op.get_bind()

    # Fetch all characters
    result = connection.execute(sa.text("SELECT id, selected_skills, expertise_skills, fighting_style, favored_enemy, favored_terrain, eldritch_invocations FROM characters"))
    characters = result.fetchall()

    for char in characters:
        char_id = char.id
        updates = {}

        # Revert selected_skills
        if char.selected_skills:
            skills = json.loads(char.selected_skills) if isinstance(char.selected_skills, str) else char.selected_skills
            if skills and isinstance(skills, list) and skills:
                if isinstance(skills[0], dict) and 'value' in skills[0]:
                    # Extract just the values
                    simple_skills = [s['value'] for s in skills if 'value' in s]
                    updates['selected_skills'] = json.dumps(simple_skills)

        # Revert expertise_skills
        if char.expertise_skills:
            expertise = json.loads(char.expertise_skills) if isinstance(char.expertise_skills, str) else char.expertise_skills
            if expertise and isinstance(expertise, list) and expertise:
                if isinstance(expertise[0], dict) and 'value' in expertise[0]:
                    simple_expertise = [e['value'] for e in expertise if 'value' in e]
                    updates['expertise_skills'] = json.dumps(simple_expertise)

        # Revert fighting_style
        if char.fighting_style:
            style = json.loads(char.fighting_style) if isinstance(char.fighting_style, str) else char.fighting_style
            if isinstance(style, dict) and 'value' in style:
                updates['fighting_style'] = style['value']

        # Revert favored_enemy
        if char.favored_enemy:
            enemy = json.loads(char.favored_enemy) if isinstance(char.favored_enemy, str) else char.favored_enemy
            if isinstance(enemy, dict) and 'value' in enemy:
                updates['favored_enemy'] = enemy['value']

        # Revert favored_terrain
        if char.favored_terrain:
            terrain = json.loads(char.favored_terrain) if isinstance(char.favored_terrain, str) else char.favored_terrain
            if isinstance(terrain, dict) and 'value' in terrain:
                updates['favored_terrain'] = terrain['value']

        # Revert eldritch_invocations
        if char.eldritch_invocations:
            invocations = json.loads(char.eldritch_invocations) if isinstance(char.eldritch_invocations, str) else char.eldritch_invocations
            if invocations and isinstance(invocations, list) and invocations:
                if isinstance(invocations[0], dict) and 'value' in invocations[0]:
                    simple_invocations = [i['value'] for i in invocations if 'value' in i]
                    updates['eldritch_invocations'] = json.dumps(simple_invocations)

        # Apply updates if any
        if updates:
            set_clause = ', '.join([f"{col} = :{col}" for col in updates.keys()])
            update_sql = f"UPDATE characters SET {set_clause} WHERE id = :char_id"
            params = {**updates, 'char_id': char_id}
            connection.execute(sa.text(update_sql), params)

    print(f"Downgrade complete: Reverted {len(characters)} characters to simple format")
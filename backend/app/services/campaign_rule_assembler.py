"""Campaign-scoped character rule assembly for Phase 0."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from app.models.campaign import Campaign
from app.services.character_rule_registry import CharacterRuleRegistry


class CampaignRuleAssembler:
    """Assemble lightweight campaign rule options from normalized packages."""

    def __init__(self, registry: CharacterRuleRegistry | None = None):
        self.registry = registry or CharacterRuleRegistry()

    def assemble_rule_options(self, campaign: Campaign) -> dict[str, Any]:
        """Build the Phase 0 rule-options response for a campaign."""
        base_package = self.registry.get_base_package()
        meta = self._coerce_meta(campaign.meta)
        enabled_package_ids = self._extract_enabled_package_ids(meta)
        toggles = self._resolve_toggles(meta)
        warnings = self._build_warnings(campaign, enabled_package_ids)

        catalog = {
            "classes": base_package["catalog"]["classes"],
            "races": base_package["catalog"]["races"],
            "backgrounds": base_package["catalog"]["backgrounds"],
            "deities": (
                base_package["catalog"]["deities"] if toggles["deity_system"] else []
            ),
        }

        return {
            "campaign_id": campaign.id,
            "selected_module_id": campaign.selected_module_id,
            "assembly_version": self._build_assembly_version(
                campaign=campaign,
                enabled_package_ids=enabled_package_ids,
                toggles=toggles,
            ),
            "packages": [base_package["package"]],
            "toggles": toggles,
            "catalog": catalog,
            "warnings": warnings,
        }

    def _coerce_meta(self, meta: Any) -> dict[str, Any]:
        return meta if isinstance(meta, dict) else {}

    def _extract_enabled_package_ids(self, meta: dict[str, Any]) -> list[str]:
        rule_assembly = meta.get("rule_assembly")
        if not isinstance(rule_assembly, dict):
            return []

        enabled_package_ids = rule_assembly.get("enabled_package_ids")
        if not isinstance(enabled_package_ids, list):
            return []

        return [str(package_id) for package_id in enabled_package_ids if package_id]

    def _resolve_toggles(self, meta: dict[str, Any]) -> dict[str, bool]:
        rule_assembly = meta.get("rule_assembly") if isinstance(meta.get("rule_assembly"), dict) else {}
        rule_toggles = (
            rule_assembly.get("rule_toggles")
            if isinstance(rule_assembly.get("rule_toggles"), dict)
            else {}
        )

        if "deity_system" in rule_toggles:
            deity_system_enabled = bool(rule_toggles.get("deity_system"))
        else:
            deity_system_enabled = bool(meta.get("enable_deity_system", False))

        return {
            "deity_system": deity_system_enabled,
        }

    def _build_warnings(self, campaign: Campaign, enabled_package_ids: list[str]) -> list[str]:
        warnings: list[str] = []
        supported_package_ids = set(self.registry.get_supported_package_ids())
        unsupported_package_ids = [
            package_id for package_id in enabled_package_ids if package_id not in supported_package_ids
        ]

        if unsupported_package_ids:
            warnings.append(
                "Phase 0 does not yet load enabled_package_ids: "
                + ", ".join(sorted(set(unsupported_package_ids)))
            )

        if campaign.selected_module_id:
            warnings.append(
                "Phase 0 does not yet load module-attached rule packages for selected_module_id "
                f"'{campaign.selected_module_id}'"
            )

        return warnings

    def _build_assembly_version(
        self,
        *,
        campaign: Campaign,
        enabled_package_ids: list[str],
        toggles: dict[str, bool],
    ) -> str:
        payload = {
            "campaign_id": campaign.id,
            "selected_module_id": campaign.selected_module_id,
            "enabled_package_ids": enabled_package_ids,
            "toggles": toggles,
            "base_package_id": self.registry.base_package_id,
        }
        digest = hashlib.sha1(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
        return f"phase0-{digest[:12]}"

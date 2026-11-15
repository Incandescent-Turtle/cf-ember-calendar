"""Simulator protocol (pluggable: ADR / FMM can be added for the GEOE 443 report)."""

from __future__ import annotations

from typing import Protocol

from rekindle.levelset import SimResult, SolverConfig, run_levelset
from rekindle.scenario import Domain, Scenario


class Simulator(Protocol):
    name: str

    def run(self, domain: Domain, scenario: Scenario) -> SimResult: ...


class LevelSetRothermel:
    name = "levelset-rothermel"

    def __init__(self, config: SolverConfig | None = None) -> None:
        self.config = config or SolverConfig()

    def run(self, domain: Domain, scenario: Scenario) -> SimResult:
        return run_levelset(domain, scenario, self.config)


__all__ = ["LevelSetRothermel", "SimResult", "Simulator", "SolverConfig"]

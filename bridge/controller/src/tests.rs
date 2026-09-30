//! The controller's own tests, after `client/src/controller/controller.test.ts`.

use super::*;
use crate::constants::{REST, TICK};

const ARM: &str = "arm-1";

fn planned(instructions: Vec<Instruction>, revision: u32, holding: Option<&str>) -> Command {
    Command::Load {
        arm: ARM.into(),
        plan: Plan {
            arm: ARM.into(),
            revision,
            holding: holding.map(str::to_owned),
            known: Vec::new(),
            instructions,
        },
    }
}

fn swing(at: Point) -> Instruction {
    Instruction::Move { to: Pose { at, facing: 0.0 }, ease: Ease::Swing }
}

/// Ticks until the arm goes idle or `seconds` pass, collecting every report.
fn run(controller: &mut Controller, seconds: f64) -> Vec<Report> {
    let mut reports = Vec::new();
    let mut at = 0.0;

    while at < seconds {
        controller.tick(TICK);
        reports.extend(controller.drain());
        at += TICK;

        if controller.telemetry().state != State::Running {
            break;
        }
    }

    reports
}

fn kinds(reports: &[Report]) -> Vec<&'static str> {
    reports
        .iter()
        .map(|report| match report {
            Report::Telemetry(_) => "telemetry",
            Report::Loaded { .. } => "loaded",
            Report::Rejected { .. } => "rejected",
            Report::Progress { .. } => "progress",
            Report::Done { .. } => "done",
            Report::Held { .. } => "held",
            Report::Resumed => "resumed",
            Report::Stopped => "stopped",
            Report::Reset => "reset",
        })
        .collect()
}

fn far(a: &Point, b: &Point) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2) + (a.z - b.z).powi(2)).sqrt()
}

#[test]
fn boots_at_rest() {
    let controller = Controller::new(ARM);
    let telemetry = controller.telemetry();

    assert_eq!(telemetry.state, State::Idle);
    assert_eq!(telemetry.revision, None);
    assert!(far(&telemetry.pad.at, &REST) < 1e-6, "{:?}", telemetry.pad.at);
}

#[test]
fn runs_its_moves_in_order_and_reports_each() {
    let mut controller = Controller::new(ARM);
    let target = Point { x: 0.8, y: 0.9, z: 1.4 };

    controller.command(planned(vec![swing(Point { x: 0.2, y: 1.8, z: 1.0 }), swing(target)], 1, None));

    let reports = run(&mut controller, 10.0);
    let telemetry = controller.telemetry();

    assert_eq!(kinds(&reports), ["loaded", "progress", "progress", "done"]);
    assert!(far(&telemetry.pad.at, &target) < 0.01, "pad {:?}", telemetry.pad.at);
    assert_eq!(telemetry.state, State::Idle);
    assert_eq!(telemetry.step, 2);
}

#[test]
fn picks_and_places_and_says_what_it_holds() {
    let mut controller = Controller::new(ARM);

    controller.command(planned(
        vec![Instruction::Pick { case: "c1".into() }, Instruction::Wait { seconds: 0.05 }],
        1,
        None,
    ));
    run(&mut controller, 5.0);
    assert_eq!(controller.telemetry().holding.as_deref(), Some("c1"));

    controller.command(planned(vec![Instruction::Place { case: "c1".into() }], 2, Some("c1")));
    run(&mut controller, 5.0);
    assert_eq!(controller.telemetry().holding, None);
}

#[test]
fn refuses_a_stale_revision_and_a_wrong_holding() {
    let mut controller = Controller::new(ARM);

    controller.command(planned(vec![], 3, None));
    controller.command(planned(vec![], 3, None));
    controller.command(planned(vec![], 4, Some("ghost")));

    let reasons: Vec<String> = controller
        .drain()
        .into_iter()
        .filter_map(|report| match report {
            Report::Rejected { reason, .. } => Some(reason),
            _ => None,
        })
        .collect();

    assert_eq!(reasons, ["revision 3 is not after 3", "holding nothing"]);
}

#[test]
fn a_gate_holds_the_arm_until_opened() {
    let mut controller = Controller::new(ARM);

    controller.command(planned(vec![Instruction::Gate { id: "belt".into() }], 1, None));
    run(&mut controller, 0.5);
    assert_eq!(controller.telemetry().state, State::Running);
    assert_eq!(controller.telemetry().step, 0);

    controller.command(Command::Open { arm: ARM.into(), gate: "belt".into() });
    let reports = run(&mut controller, 0.5);

    assert!(kinds(&reports).contains(&"done"));
}

#[test]
fn stops_refuses_plans_until_reset_and_keeps_its_revision() {
    let mut controller = Controller::new(ARM);

    controller.command(planned(vec![swing(Point { x: 0.5, y: 1.2, z: 1.2 })], 6, None));
    controller.tick(TICK);
    controller.command(Command::Stop { arm: ARM.into() });
    controller.command(planned(vec![], 7, None));

    let reasons = kinds(&controller.drain());

    assert_eq!(reasons, ["loaded", "stopped", "rejected"]);
    assert_eq!(controller.telemetry().state, State::Stopped);

    controller.command(Command::Reset { arm: ARM.into() });
    assert_eq!(controller.telemetry().state, State::Idle);
    // The last accepted revision outlives the reset, so a new hub can number its plans after it.
    assert_eq!(controller.telemetry().revision, Some(6));
}

#[test]
fn hold_and_resume() {
    let mut controller = Controller::new(ARM);

    controller.command(planned(vec![swing(Point { x: 0.6, y: 1.0, z: 1.4 })], 1, None));
    run_for(&mut controller, 0.2);
    controller.command(Command::Hold { arm: ARM.into() });
    assert_eq!(controller.telemetry().state, State::Held);

    let before = controller.telemetry().pad.at;

    run_for(&mut controller, 0.5);
    assert!(far(&controller.telemetry().pad.at, &before) < 0.2, "a held arm brakes to a stop");

    controller.command(Command::Resume { arm: ARM.into() });
    let reports = run(&mut controller, 10.0);

    assert!(kinds(&reports).contains(&"done"));
}

fn run_for(controller: &mut Controller, seconds: f64) {
    let mut at = 0.0;

    while at < seconds {
        controller.tick(TICK);
        controller.drain();
        at += TICK;
    }
}

#[test]
fn solve_and_forward_agree() {
    let target = Point { x: 0.6, y: 1.3, z: 1.2 };
    let joints = solve(&target, 0.0, 0.0);
    let back = forward(&joints);

    assert!(far(&back, &target) < 1e-9, "joints {joints:?} back {back:?}");
}

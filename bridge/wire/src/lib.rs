//! The wire's messages, as `prost` builds them from `proto/kicl/arm/v1/arm.proto`,
//! and the two calls the bridge needs: a `ToArm` off the socket, a `Report` on to it.

pub mod v1 {
    include!(concat!(env!("OUT_DIR"), "/kicl.arm.v1.rs"));
}

use prost::Message;

pub use v1::*;

/// What can be wrong with a frame off the socket.
#[derive(Debug)]
pub enum FrameError {
    /// Not a `ToArm` message at all.
    Malformed(prost::DecodeError),
    /// A `ToArm` with nothing in it, which an empty frame decodes to.
    Empty,
}

impl std::fmt::Display for FrameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FrameError::Malformed(error) => write!(f, "malformed frame: {error}"),
            FrameError::Empty => write!(f, "a message to an arm carries nothing"),
        }
    }
}

impl std::error::Error for FrameError {}

/// One frame off the socket. An empty or malformed frame is an error, never a default message.
pub fn decode_to_arm(bytes: &[u8]) -> Result<ToArm, FrameError> {
    let message = ToArm::decode(bytes).map_err(FrameError::Malformed)?;

    if message.body.is_none() {
        return Err(FrameError::Empty);
    }

    Ok(message)
}

/// One frame for the socket.
pub fn encode_report(report: &Report) -> Vec<u8> {
    report.encode_to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_report_comes_back_as_it_went() {
        let report = Report {
            arm: "arm-a".into(),
            r#type: Some(report::Type::Progress(report::Progress { revision: 3, step: 1 })),
        };
        let back = Report::decode(encode_report(&report).as_slice()).unwrap();

        assert_eq!(back, report);
    }

    #[test]
    fn an_empty_frame_is_refused() {
        assert!(decode_to_arm(&[]).is_err());
    }
}

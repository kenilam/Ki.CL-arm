from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Joints(_message.Message):
    __slots__ = ("base", "shoulder", "elbow", "wrist", "flange")
    BASE_FIELD_NUMBER: _ClassVar[int]
    SHOULDER_FIELD_NUMBER: _ClassVar[int]
    ELBOW_FIELD_NUMBER: _ClassVar[int]
    WRIST_FIELD_NUMBER: _ClassVar[int]
    FLANGE_FIELD_NUMBER: _ClassVar[int]
    base: float
    shoulder: float
    elbow: float
    wrist: float
    flange: float
    def __init__(self, base: _Optional[float] = ..., shoulder: _Optional[float] = ..., elbow: _Optional[float] = ..., wrist: _Optional[float] = ..., flange: _Optional[float] = ...) -> None: ...

class Vector(_message.Message):
    __slots__ = ("x", "y", "z")
    X_FIELD_NUMBER: _ClassVar[int]
    Y_FIELD_NUMBER: _ClassVar[int]
    Z_FIELD_NUMBER: _ClassVar[int]
    x: float
    y: float
    z: float
    def __init__(self, x: _Optional[float] = ..., y: _Optional[float] = ..., z: _Optional[float] = ...) -> None: ...

class Hex(_message.Message):
    __slots__ = ("q", "r")
    Q_FIELD_NUMBER: _ClassVar[int]
    R_FIELD_NUMBER: _ClassVar[int]
    q: int
    r: int
    def __init__(self, q: _Optional[int] = ..., r: _Optional[int] = ...) -> None: ...

class Seen(_message.Message):
    __slots__ = ("id", "kind", "top", "width", "depth", "height", "yaw", "waiting", "held")
    class Kind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        KIND_UNSPECIFIED: _ClassVar[Seen.Kind]
        KIND_CASE: _ClassVar[Seen.Kind]
        KIND_PALLET: _ClassVar[Seen.Kind]
    KIND_UNSPECIFIED: Seen.Kind
    KIND_CASE: Seen.Kind
    KIND_PALLET: Seen.Kind
    ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    TOP_FIELD_NUMBER: _ClassVar[int]
    WIDTH_FIELD_NUMBER: _ClassVar[int]
    DEPTH_FIELD_NUMBER: _ClassVar[int]
    HEIGHT_FIELD_NUMBER: _ClassVar[int]
    YAW_FIELD_NUMBER: _ClassVar[int]
    WAITING_FIELD_NUMBER: _ClassVar[int]
    HELD_FIELD_NUMBER: _ClassVar[int]
    id: str
    kind: Seen.Kind
    top: Vector
    width: float
    depth: float
    height: float
    yaw: float
    waiting: bool
    held: bool
    def __init__(self, id: _Optional[str] = ..., kind: _Optional[_Union[Seen.Kind, str]] = ..., top: _Optional[_Union[Vector, _Mapping]] = ..., width: _Optional[float] = ..., depth: _Optional[float] = ..., height: _Optional[float] = ..., yaw: _Optional[float] = ..., waiting: bool = ..., held: bool = ...) -> None: ...

class Gripper(_message.Message):
    __slots__ = ("vacuum", "contact", "payload")
    VACUUM_FIELD_NUMBER: _ClassVar[int]
    CONTACT_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_FIELD_NUMBER: _ClassVar[int]
    vacuum: bool
    contact: bool
    payload: float
    def __init__(self, vacuum: bool = ..., contact: bool = ..., payload: _Optional[float] = ...) -> None: ...

class ArmSensors(_message.Message):
    __slots__ = ("position", "velocity", "gripper", "vision", "intrusion")
    POSITION_FIELD_NUMBER: _ClassVar[int]
    VELOCITY_FIELD_NUMBER: _ClassVar[int]
    GRIPPER_FIELD_NUMBER: _ClassVar[int]
    VISION_FIELD_NUMBER: _ClassVar[int]
    INTRUSION_FIELD_NUMBER: _ClassVar[int]
    position: Joints
    velocity: Joints
    gripper: Gripper
    vision: _containers.RepeatedCompositeFieldContainer[Seen]
    intrusion: bool
    def __init__(self, position: _Optional[_Union[Joints, _Mapping]] = ..., velocity: _Optional[_Union[Joints, _Mapping]] = ..., gripper: _Optional[_Union[Gripper, _Mapping]] = ..., vision: _Optional[_Iterable[_Union[Seen, _Mapping]]] = ..., intrusion: bool = ...) -> None: ...

class Task(_message.Message):
    __slots__ = ("id", "to", "facing", "lift")
    ID_FIELD_NUMBER: _ClassVar[int]
    TO_FIELD_NUMBER: _ClassVar[int]
    FACING_FIELD_NUMBER: _ClassVar[int]
    LIFT_FIELD_NUMBER: _ClassVar[int]
    id: str
    to: Hex
    facing: float
    lift: bool
    def __init__(self, id: _Optional[str] = ..., to: _Optional[_Union[Hex, _Mapping]] = ..., facing: _Optional[float] = ..., lift: bool = ...) -> None: ...

class AmrSensors(_message.Message):
    __slots__ = ("x", "z", "heading", "lifted", "loaded", "proximity", "task")
    X_FIELD_NUMBER: _ClassVar[int]
    Z_FIELD_NUMBER: _ClassVar[int]
    HEADING_FIELD_NUMBER: _ClassVar[int]
    LIFTED_FIELD_NUMBER: _ClassVar[int]
    LOADED_FIELD_NUMBER: _ClassVar[int]
    PROXIMITY_FIELD_NUMBER: _ClassVar[int]
    TASK_FIELD_NUMBER: _ClassVar[int]
    x: float
    z: float
    heading: float
    lifted: bool
    loaded: bool
    proximity: float
    task: Task
    def __init__(self, x: _Optional[float] = ..., z: _Optional[float] = ..., heading: _Optional[float] = ..., lifted: bool = ..., loaded: bool = ..., proximity: _Optional[float] = ..., task: _Optional[_Union[Task, _Mapping]] = ...) -> None: ...

class Sensors(_message.Message):
    __slots__ = ("id", "tick", "time", "arm", "amr")
    ID_FIELD_NUMBER: _ClassVar[int]
    TICK_FIELD_NUMBER: _ClassVar[int]
    TIME_FIELD_NUMBER: _ClassVar[int]
    ARM_FIELD_NUMBER: _ClassVar[int]
    AMR_FIELD_NUMBER: _ClassVar[int]
    id: str
    tick: int
    time: float
    arm: ArmSensors
    amr: AmrSensors
    def __init__(self, id: _Optional[str] = ..., tick: _Optional[int] = ..., time: _Optional[float] = ..., arm: _Optional[_Union[ArmSensors, _Mapping]] = ..., amr: _Optional[_Union[AmrSensors, _Mapping]] = ...) -> None: ...

class ArmCommands(_message.Message):
    __slots__ = ("target", "vacuum")
    TARGET_FIELD_NUMBER: _ClassVar[int]
    VACUUM_FIELD_NUMBER: _ClassVar[int]
    target: Joints
    vacuum: bool
    def __init__(self, target: _Optional[_Union[Joints, _Mapping]] = ..., vacuum: bool = ...) -> None: ...

class AmrCommands(_message.Message):
    __slots__ = ("speed", "turn", "lift", "done")
    SPEED_FIELD_NUMBER: _ClassVar[int]
    TURN_FIELD_NUMBER: _ClassVar[int]
    LIFT_FIELD_NUMBER: _ClassVar[int]
    DONE_FIELD_NUMBER: _ClassVar[int]
    speed: float
    turn: float
    lift: bool
    done: str
    def __init__(self, speed: _Optional[float] = ..., turn: _Optional[float] = ..., lift: bool = ..., done: _Optional[str] = ...) -> None: ...

class Commands(_message.Message):
    __slots__ = ("id", "tick", "arm", "amr")
    ID_FIELD_NUMBER: _ClassVar[int]
    TICK_FIELD_NUMBER: _ClassVar[int]
    ARM_FIELD_NUMBER: _ClassVar[int]
    AMR_FIELD_NUMBER: _ClassVar[int]
    id: str
    tick: int
    arm: ArmCommands
    amr: AmrCommands
    def __init__(self, id: _Optional[str] = ..., tick: _Optional[int] = ..., arm: _Optional[_Union[ArmCommands, _Mapping]] = ..., amr: _Optional[_Union[AmrCommands, _Mapping]] = ...) -> None: ...

class Handover(_message.Message):
    __slots__ = ("position", "velocity", "vacuum", "held", "grip", "lifted")
    POSITION_FIELD_NUMBER: _ClassVar[int]
    VELOCITY_FIELD_NUMBER: _ClassVar[int]
    VACUUM_FIELD_NUMBER: _ClassVar[int]
    HELD_FIELD_NUMBER: _ClassVar[int]
    GRIP_FIELD_NUMBER: _ClassVar[int]
    LIFTED_FIELD_NUMBER: _ClassVar[int]
    position: Joints
    velocity: Joints
    vacuum: bool
    held: str
    grip: float
    lifted: bool
    def __init__(self, position: _Optional[_Union[Joints, _Mapping]] = ..., velocity: _Optional[_Union[Joints, _Mapping]] = ..., vacuum: bool = ..., held: _Optional[str] = ..., grip: _Optional[float] = ..., lifted: bool = ...) -> None: ...

class Attach(_message.Message):
    __slots__ = ("id", "robot", "blocked", "handover")
    class Robot(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        ROBOT_UNSPECIFIED: _ClassVar[Attach.Robot]
        ROBOT_ARM: _ClassVar[Attach.Robot]
        ROBOT_AMR: _ClassVar[Attach.Robot]
    ROBOT_UNSPECIFIED: Attach.Robot
    ROBOT_ARM: Attach.Robot
    ROBOT_AMR: Attach.Robot
    ID_FIELD_NUMBER: _ClassVar[int]
    ROBOT_FIELD_NUMBER: _ClassVar[int]
    BLOCKED_FIELD_NUMBER: _ClassVar[int]
    HANDOVER_FIELD_NUMBER: _ClassVar[int]
    id: str
    robot: Attach.Robot
    blocked: _containers.RepeatedCompositeFieldContainer[Hex]
    handover: Handover
    def __init__(self, id: _Optional[str] = ..., robot: _Optional[_Union[Attach.Robot, str]] = ..., blocked: _Optional[_Iterable[_Union[Hex, _Mapping]]] = ..., handover: _Optional[_Union[Handover, _Mapping]] = ...) -> None: ...

class Detach(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class SensorBatch(_message.Message):
    __slots__ = ("frames",)
    FRAMES_FIELD_NUMBER: _ClassVar[int]
    frames: _containers.RepeatedCompositeFieldContainer[Sensors]
    def __init__(self, frames: _Optional[_Iterable[_Union[Sensors, _Mapping]]] = ...) -> None: ...

class ToBridge(_message.Message):
    __slots__ = ("attach", "detach", "sensors")
    ATTACH_FIELD_NUMBER: _ClassVar[int]
    DETACH_FIELD_NUMBER: _ClassVar[int]
    SENSORS_FIELD_NUMBER: _ClassVar[int]
    attach: Attach
    detach: Detach
    sensors: SensorBatch
    def __init__(self, attach: _Optional[_Union[Attach, _Mapping]] = ..., detach: _Optional[_Union[Detach, _Mapping]] = ..., sensors: _Optional[_Union[SensorBatch, _Mapping]] = ...) -> None: ...

class FromBridge(_message.Message):
    __slots__ = ("commands",)
    COMMANDS_FIELD_NUMBER: _ClassVar[int]
    commands: _containers.RepeatedCompositeFieldContainer[Commands]
    def __init__(self, commands: _Optional[_Iterable[_Union[Commands, _Mapping]]] = ...) -> None: ...

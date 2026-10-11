//! `mjai::Bot` 중 모델과 무관한 부분(상태 갱신 + 관측/마스크 인코딩)을 JS에 노출한다.
//!
//! 흐름(= upstream `Bot::react`와 동일):
//!   1. `update(line)`  : mjai 이벤트 1줄(JSON)로 상태 갱신, 이 좌석이 행동 가능하면 true
//!   2. `encode(kan)`   : obs(1012*34) + mask(46)를 하나의 Float32Array로 반환
//!   3. (JS) onnxruntime-web으로 Q값 계산
use crate::consts::{ACTION_SPACE, obs_shape};
use crate::mjai::{Event, EventWithCanAct};
use crate::state::PlayerState;

use wasm_bindgen::prelude::*;

const VERSION: u32 = 4;

#[wasm_bindgen(start)]
fn init() {
    crate::algo::shanten::ensure_init();
    crate::algo::agari::ensure_init();
}

#[wasm_bindgen]
pub struct Session {
    state: PlayerState,
}

#[wasm_bindgen]
impl Session {
    #[wasm_bindgen(constructor)]
    pub fn new(player_id: u8) -> Result<Session, JsError> {
        if player_id >= 4 {
            return Err(JsError::new("player_id must be in 0..=3"));
        }
        Ok(Self {
            state: PlayerState::new(player_id),
        })
    }

    /// 상태를 복제한다 (리치 선언 가정 등 분기 분석용).
    pub fn fork(&self) -> Session {
        Self {
            state: self.state.clone(),
        }
    }

    /// `can_act`는 JS가 "이 시점에서 판단을 원하는가"를 넘긴다 (이벤트 JSON의 can_act도 존중).
    pub fn update(&mut self, line: &str, can_act: bool) -> Result<bool, JsError> {
        let data: EventWithCanAct = serde_json::from_str(line)
            .map_err(|e| JsError::new(&format!("failed to parse event {line}: {e}")))?;
        let cans = self
            .state
            .update(&data.event)
            .map_err(|e| JsError::new(&format!("{e:#}")))?;
        let _ = matches!(data.event, Event::None);
        Ok(can_act && !matches!(data.can_act, Some(false)) && cans.can_act())
    }

    /// 길이 `obs_len() + 46`의 Float32Array: 앞쪽 obs(행우선 1012x34), 뒤쪽 mask(0/1).
    pub fn encode(&self, kan_select: bool) -> Vec<f32> {
        let (obs, mask) = self.state.encode_obs(VERSION, kan_select);
        let mut out = Vec::with_capacity(obs.len() + ACTION_SPACE);
        out.extend(obs.iter().copied());
        out.extend(mask.iter().map(|&b| f32::from(u8::from(b))));
        out
    }

    pub fn obs_len() -> usize {
        let (c, w) = obs_shape(VERSION);
        c * w
    }

    pub fn action_space() -> usize {
        ACTION_SPACE
    }

    pub fn can_riichi(&self) -> bool {
        self.state.last_cans().can_riichi
    }

    /// 마지막 쯔모패 (mjai 표기) 또는 빈 문자열.
    pub fn last_self_tsumo(&self) -> String {
        self.state
            .last_self_tsumo()
            .map(|t| t.to_string())
            .unwrap_or_default()
    }
}

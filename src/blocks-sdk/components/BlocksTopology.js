// @flow

import * as React from 'react';
import { MIDIDeviceManager, type MIDIDevice } from './MIDIDeviceManager';
import { assert } from '../base/assert';
import { buildBlockSysExData } from '../blocks/Block';
import { TopologyDeviceInfo } from '../protocol/BlocksProtocolDefinitions';
import { BlocksDevice, kMockDeviceIndex } from './BlocksDevice';
import { Lightpad } from './Lightpad';
import {
  getBlocksMessageType,
  kMessageStartBitInDataFromDevice,
  DeviceTopologyMessage
} from '../protocol/BlocksProtocolDefinitions';

type Props = {
  code: string,
  enabled: boolean,
  onCodeExecutionError(error: *): void,
};

type DeviceTopologyInfo = {
  deviceIndex: number,
  topologyDeviceInfo: TopologyDeviceInfo,
  deviceType: string,
  midiDevice: MIDIDevice,
}

type State = {
  code: string,
  deviceTopology: Array<DeviceTopologyInfo>
};

export class BlocksTopology extends React.Component<Props, State> {
  _data: Uint8Array;
  _deviceTopology: ?Object;
  _devices: { [*]: BlocksDevice };
  _midiDeviceManager: ?MIDIDeviceManager;

  constructor(props: Props) {
    super(props);
    this._data = new Uint8Array(0);
    this._midiDeviceManager = null;
    this._deviceTopology = null;
    this._devices = {};
    this.state = {
      code: '',
      deviceTopology: [
        {
          deviceIndex: kMockDeviceIndex,
          deviceType: 'Lightpad',
          midiDevice: {
            inputPort: null,
            outputPort: null
          }
        }
      ]
    };
  }

  getDeviceTopology(): ?Object {
    return this._deviceTopology;
  }

  getMIDIDeviceFromDeviceIndex(deviceIndex: number): ?MIDIDevice {
    for (const info of this.state.deviceTopology) {
      if (info.deviceIndex === deviceIndex) {
        return info.midiDevice;
      }
    }
    return null;
  }

  sendSysEx(fromDeviceIndex: number, dataArr: Array<number>, checksumToVerify: ?number) {
    const sysExData = buildBlockSysExData(fromDeviceIndex, dataArr, checksumToVerify);
    const midiDevice = this.getMIDIDeviceFromDeviceIndex(fromDeviceIndex);
    if (midiDevice != null) {
      this.sendSysExToMidiDevice(midiDevice, sysExData);
    }
  }

  sendMidiDataToSelectedOutputPort(data: Uint8Array) {
    if (this._midiDeviceManager != null) {
      this._midiDeviceManager.sendMidiDataToSelectedOutputPort(data);
    }
  }

  sendSysExToMidiDevice(midiDevice: MIDIDevice, data: Uint8Array) {
    if (midiDevice.outputPort != null) {
      midiDevice.outputPort.send(data);
      //console.debug('sysex sent', midiDevice.outputPort, data);
    }
  }

  handleMIDIMessage = (message: any) => {
    const data = message.data; // this gives us our [command/channel, note, velocity] data.
    //console.debug('MIDI data', data); // MIDI data [144, 63, 73]
    if (data[0] !== 0xF0 && this._data.length === 0) {
      return;
    }

    const origData = this._data;
    this._data = new Uint8Array(origData.length + data.length);
    this._data.set(origData);
    this._data.set(data, origData.length);

    if (this._data[this._data.length - 1] === 0xF7) {
      const data = this._data;
      //console.debug('received sysex message', data.length, dumpUint8ArrayToHexString(data));
      const messageData = data.subarray(5, -2);
      const deviceIndex = messageData[0] & 0x3F;
      const messageType = getBlocksMessageType(messageData, kMessageStartBitInDataFromDevice);

      if (messageType === 0x01) {
        const message = new DeviceTopologyMessage();
        const processedBits = message.deserializeFromData(messageData, kMessageStartBitInDataFromDevice);
        assert(processedBits > 0);
        this._deviceTopology = message.toObject();
        console.debug('DeviceTopology', deviceIndex, this._deviceTopology);

        if (this._midiDeviceManager != null) {
          let midiDevice = this._midiDeviceManager.getMIDIDevice('Lightpad BLOCK ');
          if (midiDevice === null && this._midiDeviceManager != null) {
            // try another device name
            midiDevice = this._midiDeviceManager.getMIDIDevice('ROLI Lightpad BLOCK ');
          }
          if (midiDevice != null && this._deviceTopology != null) {
            this.setState({
              deviceTopology: this._deviceTopology.devices.map(topologyDeviceInfo => {
                return {
                  deviceIndex: topologyDeviceInfo.topologyIndex,
                  deviceType: 'Lightpad', // TODO: derive deviceType from topologyDeviceInfo.blockSerialNumber
                  midiDevice,
                  topologyDeviceInfo
                };
              })
            });
          }
        }
      } else if (data.length > 8) {
        // send message to device with specified device index
        if (deviceIndex in this._devices) {
          const device = this._devices[deviceIndex];
          BlocksDevice.prototype.processDataFromDevice.apply(device, [messageData]);
        }
      }
      this._data = new Uint8Array(0);
    }
  };

  handleMIDISuccess = () => {
    if (this.props.enabled) {
      this.setDeviceToEnabled(true);
    }
  };

  handleMIDIFailure = (error: any) => {
    console.error('onMidiFailure', error);
  };

  handleCodeExecutionError = (error: *) => {
    this.props.onCodeExecutionError(error);
  };

  handleMIDIStateChange = (event: *) => {
    console.debug('handleMIDIStateChange', event)
    if (event.port.connection === 'open' && this._midiDeviceManager != null) {
      const midiDevice = this._midiDeviceManager.getMIDIDevice(event.port.name);
      if (midiDevice != null) {
        if (midiDevice.inputPort != null && midiDevice.outputPort != null) {
          this.sendRequestTopologySysExToDevice(midiDevice);
        }
      }

    }
  };

  setDeviceToEnabled = (toEnabled: boolean) => {
    if (toEnabled) {
      // TODO
    } else {
      for (const deviceIndex in this._devices) {
        const device = this._devices[deviceIndex];
        BlocksDevice.prototype.closeDevice.apply(device);
      }
    }
  };

  sendMessageToDevice = (deviceIndex: int, param1: int, param2: int, param3: int) => {
    const device = this._devices[deviceIndex];
    if (device != null) {
      BlocksDevice.prototype.handleMessageFromOtherDevice.apply(device, [param1, param2, param3]);
    }
  };

  sendRequestTopologySysExToDevice(midiDevice: MIDIDevice) {
    console.debug('sendRequestTopologySysExToDevice', midiDevice);
    this.sendSysExToMidiDevice(midiDevice, buildBlockSysExData(0x00, [0x01, 0x01, 0x00], 0x5D));
  }

  componentDidMount() {
    for (const deviceIndex in this._devices) {
      const device = this._devices[deviceIndex];
      BlocksDevice.prototype.openDevice.apply(device);
    }
  }

  componentWillReceiveProps(newProps: Props) {
    if (this.props.code !== newProps.code) {
      console.debug('BlocksTopology code updated');
      this.setState({ code: newProps.code });
    }
    if (this.props.enabled !== newProps.enabled) {
      this.setDeviceToEnabled(newProps.enabled);
    }
  }

  render() {
    const topology = this;
    return (
      <div>
        <div id="custom-control"></div>
        <MIDIDeviceManager
          onMIDIMessage={this.handleMIDIMessage.bind(this)}
          onMIDISuccess={this.handleMIDISuccess}
          onMIDIFailure={this.handleMIDIFailure}
          onMIDIStateChange={this.handleMIDIStateChange}
          sysex={true}
          ref={(c) => this._midiDeviceManager = c} />
        <div className="blocks">
          {this.state.deviceTopology.map(info => {
            if (info.deviceType === 'Lightpad') {
              return (
                <Lightpad
                  code={topology.state.code}
                  key={info.deviceIndex}
                  topology={topology}
                  deviceIndex={info.deviceIndex}
                  topologyDeviceInfo={info.topologyDeviceInfo}
                  onCodeExecutionError={this.handleCodeExecutionError.bind(topology)}
                  ref={c => (c != null) ? this._devices[info.deviceIndex] = c : null} />
              );
            } else {
              return null;
            }
          })}
        </div>
      </div>
    );
  }
}

export default BlocksTopology;
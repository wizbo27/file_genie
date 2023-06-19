/* eslint-disable @lwc/lwc/no-inner-html */
/* eslint-disable vars-on-top */
/* eslint-disable no-undef */
import {
    api,
    LightningElement
} from 'lwc';
import {
    ShowToastEvent
} from 'lightning/platformShowToastEvent';
import {
    loadScript
} from 'lightning/platformResourceLoader';
import {
    FlowNavigationNextEvent,
    FlowNavigationFinishEvent
} from 'lightning/flowSupport';
import jszip from "@salesforce/resourceUrl/jszip";
import getCDBlob from '@salesforce/apex/fg_Manager.getCDBlob';
import insertCV from '@salesforce/apex/fg_Manager.insertCV';
import getRecords from '@salesforce/apex/AuraEnabledUtilities.getRecords';
import dbUpdate from '@salesforce/apex/AuraEnabledUtilities.dbUpdate';
import { reduceErrors } from 'c/ldsUtils';

export default class Test extends LightningElement {
    globalWB = {
        worksheets: [],
        sharedStrings: ''
    };
    globalZip = null;
    mapping = {};
    @api recordIdIn;
    @api logIn;
    @api mappingIn;
    @api contentDocIdIn;
    @api availableActions = [];
    @api recDataIn;
    @api base64In;
    @api fileNameIn;
    @api sObjectAPI;
    @api filterString;
    filters=[];
    documentTemplate;
    pageLoading = true;
    KeyWords = ['TODAY'];

    connectedCallback() {
        this.init();
    }

    async init() {
        try {
            await loadScript(this, jszip);
        } catch (error) {
            this.handleErrors(error,'Error loading zip library',this.logIn);
            return;
        }
        try {
            this.mapping.Content_Document_Id__c = this.contentDocIdIn;
            this.mapping.Mapping__c = JSON.parse(this.mappingIn);
            this.mapping.recordId = this.recordIdIn;
            this.mapping.File_Name__c = this.fileNameIn;
            this.mapping.sObject_API__c = this.sObjectAPI;
            console.log(this.mapping);


            if(this.filterString){
                this.filters= this.filterString.split('","');
            }

            var baseObjectFields = new Set();
            for (let sObject of this.mapping.Mapping__c.sObjects) {
                let matches = [...sObject.Query.matchAll('{{1}(.*?)}{1}')];
                for (let match of matches) {
                    if(!match[1].includes('!filter'))
                    baseObjectFields.add(match[1]);
                    else if(this.filters!=null && this.filters.length>0)
                    sObject.query = sObject.Query.replaceAll(match[0], this.filters[parseInt(matches[1].replace('!filter',''),10)]);
                }
            }
            
            let baseObjectRecord
            if (baseObjectFields.size > 0 && this.mapping.recordId) {
                let baseObjectQuery = 'SELECT ' + Array.from(baseObjectFields).join(',') + ' FROM ' + this.mapping.sObject_API__c + " WHERE Id='" + this.mapping.recordId + "' LIMIT 1";
                baseObjectRecord = await getRecords({query: baseObjectQuery});
            }

            for (let sObject of this.mapping.Mapping__c.sObjects) {
                if(baseObjectRecord){
                    let matches = [...sObject.Query.matchAll('{{1}(.*?)}{1}')];
                    for (let match of matches) {
                        baseObjectFields.add(match[1]);
                        sObject.Query = sObject.Query.replaceAll(match[0], baseObjectRecord[0][(match[1])]);
                    }
                }
                // eslint-disable-next-line no-await-in-loop
                let data = await getRecords({ query: sObject.Query});
                sObject.data = data;
                if (!data) throw 'No Data Returned';
            }
        } catch (error) {
            this.handleErrors(error,'Error Loading Records',this.logIn);
            return;
        }
        try{
            this.globalZip = await this.loadZIPDocument(this.mapping.Content_Document_Id__c);
            this.globalWB = await this.xl_ParseWorkBook(this.globalZip);
            this.xl_processDoc(this.mapping, this.globalWB);
            this.globalZip = this.xl_FinalizeZip(this.globalZip, this.globalWB);
            this.save(this.mapping, this.globalZip,this.logIn);

        }catch(error){
            this.handleErrors(error,'Failed to Merge Document',this.logIn);
            return;
        }
        


        if (this.availableActions.find((action) => action === 'NEXT')) {
            // navigate to the next screen
            const navigateFinishEvent = new FlowNavigationNextEvent();
            this.dispatchEvent(navigateFinishEvent);
        } else if (this.availableActions.find((action) => action === 'FINISH')) {
            const navigateNextEvent = new FlowNavigationFinishEvent();
            this.dispatchEvent(navigateNextEvent);
        }
    }

    xl_processDoc(mapping, workbook) {

        //collect Shared String Cells from each worksheet
        var wsShareStringCells = [];
        for (let worksheet of workbook.worksheets) {
            wsShareStringCells = wsShareStringCells.concat([...worksheet.querySelectorAll('c[t="s"]')]);
        }
        //collect shared strings at root tag
        var sharedStrings = workbook.sharedStrings.querySelectorAll('si');
        //process all shared string cells and replace the cells v tag with is and t tag with real strings
        for (let element of wsShareStringCells) {
            let index = parseInt(element.children[0].innerHTML, 10);
            if (sharedStrings[index]) {
                element.innerHTML = '<is>' + sharedStrings[index].innerHTML + '</is>';
                element.setAttribute('t', 'inlineStr'); //set data type to inline string
            }
        }


        //search for Tables first
        var wsTablesStartElms = [];
        for (let worksheet of workbook.worksheets) {
            wsTablesStartElms = wsTablesStartElms.concat(this.querySelectorMatchText(worksheet, 't', '{{1}(?:tablerow for=).*}{1}'));
        }
        //process tables 
        for (let tableStartElement of wsTablesStartElms) {
            let tableMapKey = tableStartElement.textContent.substring(tableStartElement.textContent.indexOf('tablerow for=') + 13, tableStartElement.textContent.indexOf('}'));
            let object = (mapping.Mapping__c.sObjects).find(el => el.mapKey == tableMapKey);
            let tableStartRowNum = parseInt((tableStartElement.closest('row')).getAttribute('r'), 10);
            let rows = tableStartElement.ownerDocument.querySelectorAll('row');
            let tableEndElement = this.querySelectorMatchText(rows[tableStartRowNum - 1], 't', '{{1}(?:/tablerow)}{1}')[0];
            tableStartElement.textContent = tableStartElement.textContent.replace('{tablerow for=' + tableMapKey + '}', '');
            tableEndElement.textContent = tableEndElement.textContent.replace('{/tablerow}', '');
            if (object && object.data) this.tableHandler(rows, object.data.length, tableStartRowNum, object.data);
        }

        //Search for foreach 
        var wsforEachStartElms = [];
        for (let worksheet of workbook.worksheets) {
            wsforEachStartElms = wsforEachStartElms.concat(this.querySelectorMatchText(worksheet, 't', '{{1}(?:foreach from=).*}{1}'));
        }

        //process foreach
        for (let forEachElement of wsforEachStartElms) {
            let foreachkey = forEachElement.textContent.match('{{1}(?:foreach from=)(.+?(?=}))}{1}');
            //console.log(foreachkey[1]);
            let tableMapKey = foreachkey[1];
            //console.log(tableMapKey);
            let object = (mapping.Mapping__c.sObjects).find(el => el.mapKey == tableMapKey);
            if (object) {
                console.log(object);
                forEachElement.innerHTML = this.htmlEncode(this.forEachHandler(object.data, forEachElement, tableMapKey));
            } else {
                forEachElement.textContent = '';
            }
        }

        //collect all merge fields across all worksheets in an array 
        var wsTElmsWithMergeFields = [];
        for (let worksheet of workbook.worksheets) {
            wsTElmsWithMergeFields = wsTElmsWithMergeFields.concat(this.querySelectorMatchText(worksheet, 't', '{+.*}+'));
        }
        //process all other merges
        for (let wsTElmsWithMergeField of wsTElmsWithMergeFields) {
            let replacements = [...wsTElmsWithMergeField.innerHTML.matchAll("{{1}\\${1}(.*?)}")];
            let dataType;
            for (let mergeFieldMatch of replacements) {
                let mergeField = mergeFieldMatch[1];
                let path = (mergeField).split('.');
                let object = (mapping.Mapping__c.sObjects).find(el => el.mapKey == path[0]);
                if (object) {
                    let mergeData = object.data[0];
                    path.shift();
                    for (let node of path) {
                        if (mergeData) {
                            mergeData = (mergeData)[node];
                        } else {
                            break;
                        }
                    }
                    dataType = typeof mergedata;
                    wsTElmsWithMergeField.innerHTML = wsTElmsWithMergeField.innerHTML.replace(mergeFieldMatch[0], this.htmlEncode(mergeData));
                } else {
                    wsTElmsWithMergeField.innerHTML = wsTElmsWithMergeField.innerHTML.replace(mergeFieldMatch[0], '');
                }
            }
            if (replacements.length > 0) {
                this.xl_updateCellDatatype(wsTElmsWithMergeField.closest('c'), dataType);
            }
        }

        //merge file name 
        let replacements = [...mapping.File_Name__c.matchAll("{{1}\\${1}(.*?)}")];
        for (let mergeFieldMatch of replacements) {
            let mergeField = mergeFieldMatch[1];
            let path = (mergeField).split('.');
            let object = (mapping.Mapping__c.sObjects).find(el => el.mapKey == path[0]);
            if (object) {
                let mergeData = object.data[0];
                path.shift();
                for (let node of path) {
                    if (mergeData) {
                        mergeData = (mergeData)[node];
                    } else {
                        break;
                    }
                }
                if (mergeData != null) {
                    mapping.File_Name__c = mapping.File_Name__c.replace(mergeFieldMatch[0], mergeData);
                } else {
                    mapping.File_Name__c = mapping.File_Name__c.replace(mergeFieldMatch[0], '');
                }
            }
        }

        console.log(mapping.File_Name__c);

        for (let worksheet of workbook.worksheets) {
            for (let formulaElm of worksheet.querySelectorAll('f')) {
                formulaElm.setAttribute('ca', '1');
            }
        }

        return workbook;
    }
    xl_updateCellDatatype(cell, jsType) {
        if (!cell || !jsType) return null;
        let newType;
        switch (jsType) {
            case 'boolean':
                newType = 'b';
                break;
            case 'number':
                newType = 'n';
                break;
            default:
                break;
        }
        //update data type
        if (newType) {
            cell.setAttribute('t', newType);
            let tTag = cell.querySelector('t');
            if (tTag) {
                cell.innerHTML = '<v>' + tTag.innerHTML + '</v>';
            }
        }
        return cell;
    }
    xl_FinalizeZip(zip, wb) {
        zip.remove("xl/sharedStrings.xml");
        let counter = 1;
        for (let ws of wb.worksheets) {
            console.log(ws.documentElement);
            zip.file("xl/worksheets/sheet" + counter + ".xml", ws.documentElement.outerHTML);
            counter++;
        }
        return zip;
    }



    forEachHandler(data, element, tableMapKey) {
        if (!data) return ''
        let foreachkey = element.textContent.match(/{(?:foreach from=).+?(?=})}(.*){\/foreach}/s);
        let forEachInnerString = foreachkey[1];
        let replacements = [...forEachInnerString.matchAll("{{1}\\${1}(.*?)}")];
        var mergeDataOut = '';
        for (let record of data) {
            let output = forEachInnerString;
            for (let mergeFieldMatch of replacements) {
                let mergeData = record;
                let mergeField = mergeFieldMatch[1];
                let path = mergeField.split('.');
                for (var node of path) {
                    if (mergeData) {
                        mergeData = (mergeData)[node];
                    } else {
                        break;
                    }
                }

                output = output.replace(mergeFieldMatch[0], this.htmlEncode(mergeData));
            }
            mergeDataOut += output + '\n';
        }
        return mergeDataOut;
    }

    tableHandler(rows, amountToShift, startRowIndex, data) {
        let startRow = rows[startRowIndex - 1];
        let lastNewRow = startRow;
        let rowCounter = 0;
        let rowTemplate = startRow.cloneNode(true);
        let rowCellMerges = new Set();
        let newrowCellMerges = new Set();
        var ws = rows[0].ownerDocument;
        var mergeCells = ws.querySelector('mergeCells');
        var mergeCellsChildren;
        if (mergeCells) {
            mergeCellsChildren = mergeCells.children;
            //check for merges in row to clone
            for (let cell of startRow.children) {
                let merge = this.isMergedCell(cell, mergeCellsChildren);
                if (merge) rowCellMerges.add(merge);
            }
        }

        for (let i = startRowIndex; i < (startRowIndex + amountToShift); i++) {
            //duplicate row merges
            for (let merge of rowCellMerges) {
                let newMerge = merge.cloneNode(true);
                let range = newMerge.getAttribute('ref');
                let rangeData = this.getRangeData(range);
                range = range.replace(rangeData.r1Num, i);
                range = range.replace(rangeData.r2Num, i);
                newMerge.setAttribute('ref', range);
                newrowCellMerges.add(newMerge);
            }

            let newRow = rowTemplate.cloneNode(true); //clone row
            newRow.setAttribute('r', i); //set new row number
            //modify inner cells and merge data
            for (let cell of newRow.children) {
                let cellAddress = cell.getAttribute('r');
                let cellNumber = parseInt(cellAddress.match(/(\d+)/), 10);
                cell.setAttribute('r', cellAddress.replace(cellNumber, i));
                //search for forEach cells
                let forEach = cell.innerHTML.match(/{(?:foreach from=)(.+?(?=}))}.*{\/foreach}/s);
                if (forEach) {
                    let tTag = cell.querySelector('t');
                    let tableMapKey = forEach[1];
                    let dataSubset = (data[rowCounter])[tableMapKey];
                    let foreachReturn = this.forEachHandler(dataSubset, tTag, tableMapKey);
                    tTag.innerHTML = tTag.innerHTML.replace(forEach[0],this.htmlEncode(foreachReturn));
                }
                let dataType;
                //process all other merge fields in th cell
                var replacements = [...cell.textContent.matchAll("{{1}\\${1}(.*?)}")];
                for (var mergeFieldMatch of replacements) {
                    let mergeData = data[rowCounter];
                    let mergeField = mergeFieldMatch[1];
                    let path = mergeField.split('.');
                    path.shift();
                    for (var node of path) {
                        if (mergeData) {
                            mergeData = (mergeData)[node];
                        } else {
                            break;
                        }
                    }
                    dataType = typeof mergeData;
                    let tTag = cell.querySelector('t');
                    if (tTag)
                        tTag.innerHTML = tTag.innerHTML.replace(mergeFieldMatch[0], this.htmlEncode(mergeData));
                }
                if (replacements.length > 0) {
                    this.xl_updateCellDatatype(cell, dataType);
                }
            }
            rowCounter++;
            lastNewRow.parentNode.insertBefore(newRow, lastNewRow.nextSibling);
            lastNewRow = newRow;

        }
        startRow.remove();
        //rowCellMerges[0].append(newrowCellMerges);

        //shift all other cells below table down by amountToShift
        for (var i = startRowIndex; i < rows.length; i++) {
            let rowNum = parseInt(rows[i].getAttribute('r'), 10);
            let newRowNumber = rowNum + amountToShift - 1;
            rows[i].setAttribute('r', newRowNumber);
            for (let cell of rows[i].children) {
                let mergeCell = this.isMergedCell(cell, mergeCellsChildren);
                if (mergeCell) {
                    let rangeData = this.getRangeData(mergeCell.getAttribute('ref'));
                    mergeCell.setAttribute('ref', rangeData.r1Char + (rangeData.r1Num + amountToShift - 1) + ':' + rangeData.r2Char + (rangeData.r2Num + amountToShift - 1));
                }
                let cellAddress = cell.getAttribute('r');
                let cellNumber = parseInt(cellAddress.match(/(\d+)/), 10);
                cell.setAttribute('r', cellAddress.replace(cellNumber, newRowNumber));
            }
        }
        if (mergeCells) {
            for (let newMergeCell of newrowCellMerges) {
                mergeCells.append(newMergeCell);
            }
            for (let cellMerge of rowCellMerges) {
                cellMerge.remove();
            }
            mergeCells.setAttribute('count', mergeCells.children.length);
        }
    }


    isMergedCell(cell, mergedCellElements) {
        var cellIndex = cell.getAttribute('r');
        var mergeCells = Array.from(mergedCellElements);
        var match = mergeCells.find(mergeCell => {
            var mergedRange = mergeCell.getAttribute('ref');
            return this.cellIndexInRange(cellIndex, mergedRange);
        });
        return match;
    }

    cellIndexInRange(cellIndex, range) {
        let rangeData = this.getRangeData(range);
        let cellIndexData = this.getCellIndex(cellIndex);
        let cCharVal = cellIndexData.char.split('').map(item => item.charCodeAt(0)).reduce((prev, next) => prev + next);
        let R1CharVal = rangeData.r1Char.split('').map(item => item.charCodeAt(0)).reduce((prev, next) => prev + next);
        let R2CharVal = rangeData.r2Char.split('').map(item => item.charCodeAt(0)).reduce((prev, next) => prev + next);
        return (cCharVal >= R1CharVal && cellIndexData.num >= rangeData.r1Num && cCharVal <= R2CharVal && cellIndexData.num <= rangeData.r2Num);
    }

    getRangeData(rangeString) {
        var rangeData = {};
        rangeData.rangeIndexes = rangeString.split(':');
        rangeData.r1Char = rangeData.rangeIndexes[0].match('[A-Z]+')[0];
        rangeData.r2Char = rangeData.rangeIndexes[1].match('[A-Z]+')[0];
        rangeData.r1Num = parseInt(rangeData.rangeIndexes[0].match(/(\d+)/), 10);
        rangeData.r2Num = parseInt(rangeData.rangeIndexes[1].match(/(\d+)/), 10);
        return rangeData;
    }

    getCellIndex(cellIndexString) {
        var cellIndexData = {};
        cellIndexData.char = cellIndexString.match('[A-Z]+')[0];
        cellIndexData.num = parseInt(cellIndexString.match(/(\d+)/), 10);
        return cellIndexData;
    }

    querySelectorMatchText(elm, selector, text) {
        return Array.from(elm.querySelectorAll(selector))
            .filter(el => el.textContent.match(text));
    }

    htmlEncode(value) {
        try {
            console.log(value);
            if (value == null) {
                return '';
            }
            value = (String(value)).replaceAll('<br>', '\n');
            const parser = new DOMParser();
            var elm = parser.parseFromString('<t></t>', "text/xml");
            elm.firstChild.textContent = value;
        } catch (error) {
            console.log(value);
            console.log(elm);
            console.log(error);
            return 'htmlEncoding Error';
        }
        console.log(elm.firstChild.innerHTML);
        return elm.firstChild.innerHTML;
    }

    htmlDecode(value) {
        try {
            if (!value) {
                return '';
            }
            const parser = new DOMParser();
            var elm = parser.parseFromString('<t></t>', "text/xml");
            elm.firstChild.innerHTML = value;
        } catch {
            console.log(error);
            return 'htmlDecoding Error';
        }
        return elm.firstChild.textContent;
    }



    async save(mapping, zip,logID) {
        var base64 = await zip.generateAsync({
            type: "base64"
        });
        //location.href="data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + base64;
        // let record = {
        //     'sobjectType': 'ContentVersion'
        // };
        // record['Title'] = mapping.File_Name__c;
        // record['PathOnClient'] = mapping.File_Name__c + '.xlsx';
        // record['VersionData'] = base64;
        // record['FirstPublishLocationId'] = mapping.recordId;
        // let records = [record];

        insertCV({
                fileName: (mapping.File_Name__c + '.xlsx'),
                base64Data: base64,
                recordId: mapping.recordId
            })
            .then((result) => {
                let record = {
                    'sobjectType': 'fg_Log__c'
                };
                record.Id=logID;
                record.Document_Data__c=JSON.stringify(mapping);
                record.Base64ContentDoc__c=this.documentTemplate;
                record.Status__c='Success';
                let records = [record];
                dbUpdate({sObjects:records})
                    .then((result1) => console.log(result1))
                    .catch((error) => {
                        this.handleErrors(error,'Error Updating Log',logID);
                    }
                );
                console.log(result);
            })
            .catch((error) => {
                this.handleErrors(error,'Error Inserting File',logID);
            }
        );

        
    }

    async loadZIPDocument(contentDocumentID) {

        var result = await getCDBlob({
            cdId: contentDocumentID
        });
        var zip = await JSZip.loadAsync(result, {
            base64: true
        }); // 1) read the Blob
        this.globalZip = zip;
        this.documentTemplate=result;
        return zip;
    }

    async xl_ParseWorkBook(zip) {
        var wb = {
            worksheets: [],
            sharedStrings: ''
        }
        zip.folder("xl/worksheets").forEach(function (relativePath, file) {
            //console.log("iterating over", relativePath);
            if (file.name.endsWith('xml')) {
                file.async("string").then(worksheet => {
                    const parser = new DOMParser();
                    var worksheetXML = parser.parseFromString(worksheet, "text/xml");
                    wb.worksheets.push(worksheetXML);
                });
            }
        });

        var sharedStringData = await zip.file("xl/sharedStrings.xml").async("string")
        const parser = new DOMParser();
        wb.sharedStrings = parser.parseFromString(sharedStringData, "text/xml");
        return wb;
    }

    updateLogWithError(error,logID){
        let record = {
            'sobjectType': 'fg_Log__c'
        };
        record.Id=logID;
        record.Document_Data__c=error;
        record.Status__c='Error';
        let records = [record];
        dbUpdate({sObjects:records})
            .then((result) => console.log(result))
            .catch((error1) => this.dispatchEvent(
                new ShowToastEvent({title: 'Error Updating Log with errors',message: error1,variant: 'error',})
            ));
    }

    handleErrors(error,toastTitle,logID){
        let errorMSG;
        errorMSG = reduceErrors(error);
        console.log(errorMSG,error.stack);
        console.log(toastTitle);
        
        this.dispatchEvent(new ShowToastEvent({title: toastTitle,message: (errorMSG.join('\n')),variant: 'error',}));
        this.updateLogWithError(errorMSG.join('\n'),logID);
    }
}
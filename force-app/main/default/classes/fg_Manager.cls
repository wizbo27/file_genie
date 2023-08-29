public class fg_Manager 
{
    
    public class mdSObject{
        String Query;
        List<sobject> data;
        String mapKey;
        String sObjectAPI;
    }
    public class documentBundle{
        List<mdSObject> sObjects;
        fg_Mapping__mdt mdRecord;
        String base64Data;
        fg_Log__c log;
    }
    public class FlowInputs{
        @InvocableVariable(required=true label='List of Log Record Id(s)')
        public List<string> logIds;
        @InvocableVariable(required=true label='File Genie Custom Metadata Records')
        public fg_mapping__mdt mapping;
        @InvocableVariable(label='Base RecordID That Trigger Document Creation')
        public String baserecordId;
    }

    @InvocableMethod(label ='Merge Document'description ='Generates Documents'category ='File Genie')
    public static List<FlowInputs> start(List<FlowInputs> flowDatas){
        system.debug(flowDatas);
        for (FlowInputs flowData : flowDatas) {
            // List<fg_Log__c> logs =[SELECT Id,Record_Id__c FROM fg_Log__c WHERE ID IN:flowData.logIds];
            // String templateB64 = getCDBlob(flowData.mapping.Content_Document_Id__c);
            // documentBundle docBundleTemplate =(documentBundle)JSON.deserialize(flowData.mapping.Mapping__c, documentBundle.class);
            // docBundleTemplate.base64Data = templateB64;
            // docBundleTemplate.mdRecord=flowData.mapping;
            // Set<String> baseObjectFields = new Set<String>();
            // sObject baseObject;
            // //search for merges in query string
            // for(mdSObject mdsObject :docBundleTemplate.sObjects){
            //     system.debug(mdsObject.Query);
            //     Matcher pm = Pattern.compile('\\{(.*?)\\}').matcher(mdsObject.Query);
            //     while (pm.find()) {
            //         String match = pm.group();
            //         match=match.replace('{', '');
            //         match=match.replace('}', '');
            //         baseObjectFields.add(match);
            //         system.debug(pm.group());
            //     }                
            // }
            // //query base object for query merges
            // if (baseObjectFields.size()>0 && flowData.baserecordId!=null) {
            //     baseObject=Database.query('SELECT '+ String.join(new List<String>(baseObjectFields),',')+' FROM '+docBundleTemplate.mdRecord.sObject_API__c+' WHERE ID=\''+flowData.baserecordId+'\' LIMIT 1');
            //     //merge data with query strings
            //     for(mdSObject mdsObject :docBundleTemplate.sObjects){
            //         Matcher pm = Pattern.compile('\\{(.*?)\\}').matcher(mdsObject.Query);
            //         while (pm.find()) {
            //             String match = (pm.group());
            //             match = match.replace('{', '');
            //             match= match.replace('}', '');
            //             mdsObject.Query=mdsObject.Query.replaceAll('\\{'+match+'\\}',(String)baseObject.get(match));
            //         } 
            //     }
            // }
            
            // //query data
            // for(mdSObject mdsObject :docBundleTemplate.sObjects){
            //     mdsObject.data=Database.query(mdsObject.Query);
            // }
            // for (fg_Log__c log : logs) {
            //     documentBundle mapping = (documentBundle)JSON.deserialize(JSON.serialize(docBundleTemplate), documentBundle.class);
            //     mapping.log=log;
            //     requestFile(JSON.serialize(mapping));
            // }
        }
        return flowDatas;
    }
    @AuraEnabled
    public static string getCDBlob(Id cdId){
        String query = 'SELECT VersionData FROM ContentVersion WHERE ContentDocumentId = \'' + cdID + '\' AND IsLatest=TRUE';
        List<SObject> returningList = Database.query(query);
        system.debug(returningList);
        return EncodingUtil.Base64Encode((Blob)returningList.get(0).get('VersionData'));
    }

    
    @AuraEnabled
    public static string insertCV(String fileName,string base64Data,String recordId){
        //system.debug(base64Data);
        ContentVersion cv = new ContentVersion();
        cv.FirstPublishLocationId=recordId;
        cv.Title=fileName;
        cv.PathOnClient=fileName;
        cv.VersionData=EncodingUtil.base64Decode((string)base64Data);
        insert(cv);
        return 'Success';
    }

    // public static documentBundle setupBundleData(documentBundle mapEXT,fg_Log__c log){
    //     for (mdSObject cObject : mapEXT.sObjects) {
    //         cObject.data=database.query(cObject.Query);
    //     }
    //     return mapEXT;
    // }
    //@InvocableMethod(label ='Merge Document'description ='Generates Documents'category ='File Genie')
    // @future(callout=true)
    // public static void requestFile(string mapping)
    // {
    //     try {
    //         Http http = new Http();
    //         HttpRequest req = new HttpRequest();
    //         req.setEndpoint('https://bizkgzxmfc2muuychatkdpdbjq0ecknz.lambda-url.us-east-1.on.aws/');
    //         req.setMethod('GET');
    //         req.setBody(mapping);
    //         HttpResponse res = http.send(req);
    //         System.debug('#### response : '+res);
    //         System.debug('#### response.getBody : '+res.getBody());
    //         //if resp call (insertcv with data)
    //     }
    //     catch(Exception e)
    //     {
    //         System.debug('Exception type caught: ' + e.getTypeName()); 
    //         System.debug('Message: ' + e.getMessage()); 
    //         System.debug('Line number: ' + e.getLineNumber());
    //     }      
    // }
}